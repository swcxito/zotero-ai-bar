import type { ModelMessage } from 'ai';
import type { Session, TokenUsage } from '../chatManager';
import { normalizeTranslationResultCandidate, type TranslationRequestMeta } from '../../utils/translation';
import { onLLMStreamStartV2, onLLMStreamUpdateV2, onLLMStreamEndV2, onLLMStreamErrorV2, onTranslationResultV2 } from '../chatUI';
import { getPref } from '../../utils/prefs';
import { buildClaudeInput, claudeCodeModelSelection, claudeEffort, redactClaudeError } from './protocol';
import { runClaudeCode } from './runtime';
import { claudeCodeEfforts, refreshClaudeCodeModels } from './settings';
import { zoteroToolServer } from './tools';

export async function streamClaudeCode(
  messagesPromise: ModelMessage[] | Promise<ModelMessage[]>, session: Session, translation?: TranslationRequestMeta
): Promise<void> {
  const signal = session.pending.abortController?.signal;
  let usage: TokenUsage | undefined;
  try {
    onLLMStreamStartV2(session);
    const messages = await messagesPromise;
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const agent = !translation && session.effectiveChatMode === 'agent';
    const model = claudeCodeModelSelection(translation?.modelKey, addon.data.userProviderConfigV2?.active);
    if (!model) throw new Error('Select a Claude Code model first.');
    // Same rule as Codex: translation uses the lowest level unless it follows the chat.
    const efforts = claudeCodeEfforts(model);
    const effort = claudeEffort(
      efforts,
      translation && getPref('translate.thinkingDepth') !== 'follow-chat'
        ? efforts[0]
        : (session.pending.thinkingEffortOverride ?? session.claudeThinkingEffort ?? session.thinkingEffort)
    );
    // Agent mode: each assistant message is its own text block, so text written
    // after a tool call renders below that tool's card. Before a tool card is
    // added, the text written so far is rendered in full (streaming renders are throttled).
    let unflushed: { fullText: string; segmentText: string } | undefined;
    const server = agent
      ? zoteroToolServer(session, signal, messages, async () => {
        const pending = unflushed;
        unflushed = undefined;
        if (pending?.segmentText.trim() && !signal?.aborted) await onLLMStreamUpdateV2({ session, ...pending, force: true });
      })
      : undefined;
    const result = await runClaudeCode(model, buildClaudeInput(messages, !!translation), signal, async (fullText, segmentText) => {
      if (translation || signal?.aborted) return;
      if (!agent) return onLLMStreamUpdateV2({ session, fullText });
      unflushed = { fullText, segmentText };
      if (segmentText.trim()) await onLLMStreamUpdateV2({ session, fullText, segmentText });
    }, effort, server);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    // After a CLI upgrade the aliases point at new versions; update the menu names in the background.
    void refreshClaudeCodeModels(result.path, result.version).catch(() => undefined);
    if (result.usage) {
      const promptTokens = (result.usage.input_tokens || 0) + (result.usage.cache_read_input_tokens || 0) + (result.usage.cache_creation_input_tokens || 0);
      const completionTokens = result.usage.output_tokens || 0;
      usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
    }
    if (translation) {
      const text = result.text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new Error('Claude Code returned invalid translation JSON. Please retry.'); }
      const normalized = normalizeTranslationResultCandidate(parsed, translation.selectedText);
      if (!normalized) throw new Error('Claude Code returned an incomplete translation. Please retry.');
      onTranslationResultV2(session, normalized);
    } else if (!agent) await onLLMStreamUpdateV2({ session, fullText: result.text, force: true });
    else if (result.segment.trim()) await onLLMStreamUpdateV2({ session, fullText: result.text, segmentText: result.segment, force: true });
    onLLMStreamEndV2(session, usage);
  } catch (error) {
    if (signal?.aborted || (error as Error).name === 'AbortError' || (error as Error).name === 'FullTextRequestCancelledError')
      onLLMStreamEndV2(session, usage, true);
    else onLLMStreamErrorV2({ session, error: redactClaudeError((error as Error).message || 'Claude Code request failed.') });
  }
}

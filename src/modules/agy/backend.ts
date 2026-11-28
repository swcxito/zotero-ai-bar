import type { ModelMessage } from 'ai';
import type { Session, TokenUsage } from '../chatManager';
import { normalizeTranslationResultCandidate, type TranslationRequestMeta } from '../../utils/translation';
import { onLLMStreamStartV2, onLLMStreamUpdateV2, onLLMStreamEndV2, onLLMStreamErrorV2, onTranslationResultV2 } from '../chatUI';
import { getPref } from '../../utils/prefs';
import { agyEffort, agyModelSelection, buildAgyPrompt, redactAgyError } from './protocol';
import { runAgy } from './runtime';
import { agyEfforts, refreshAgyModels } from './settings';
import { zoteroAgyToolServer } from './tools';

export async function streamAgy(
  messagesPromise: ModelMessage[] | Promise<ModelMessage[]>,
  session: Session,
  translation?: TranslationRequestMeta
): Promise<void> {
  const controller = session.pending.abortController;
  const signal = controller?.signal;
  let usage: TokenUsage | undefined;
  try {
    onLLMStreamStartV2(session);
    const messages = await messagesPromise;
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const agent = !translation && session.effectiveChatMode === 'agent';
    const model = agyModelSelection(translation?.modelKey, addon.data.userProviderConfigV2?.active);
    if (!model) throw new Error('Select an Antigravity model first.');
    // Same rule as Codex and Claude Code: translation uses the lowest level unless it follows the chat.
    const efforts = agyEfforts(model);
    const effort = agyEffort(
      efforts,
      translation && getPref('translate.thinkingDepth') !== 'follow-chat'
        ? efforts[0]
        : (session.pending.thinkingEffortOverride ?? session.agyThinkingEffort ?? session.thinkingEffort)
    );
    // Agent mode: each assistant segment renders in its own text block so text written
    // after a tool call renders below that tool's card.
    let unflushed: { fullText: string; segmentText: string } | undefined;
    const server = agent
      ? zoteroAgyToolServer(session, signal, messages, async () => {
          const pending = unflushed;
          unflushed = undefined;
          if (pending?.segmentText.trim() && !signal?.aborted) await onLLMStreamUpdateV2({ session, ...pending, force: true });
        })
      : undefined;
    const result = await runAgy(
      model,
      buildAgyPrompt(
        messages,
        !!translation,
        server?.tools.map((tool) => tool.name)
      ),
      signal,
      async (fullText, segmentText) => {
        if (translation || signal?.aborted) return;
        if (!agent) return onLLMStreamUpdateV2({ session, fullText });
        unflushed = { fullText, segmentText };
        if (segmentText.trim()) await onLLMStreamUpdateV2({ session, fullText, segmentText });
      },
      effort,
      server
    );
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    // Refresh the model list in the background when the CLI version changes.
    void refreshAgyModels(result.version).catch(() => undefined);
    if (result.usage) {
      const promptTokens = (result.usage.inputTokens || 0) + (result.usage.cachedReadTokens || 0) + (result.usage.cachedWriteTokens || 0);
      const completionTokens = result.usage.outputTokens || 0;
      const totalTokens = result.usage.totalTokens || promptTokens + completionTokens;
      usage = { promptTokens, completionTokens, totalTokens };
    }
    if (translation) {
      const text = result.text
        .trim()
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```$/, '');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Antigravity returned invalid translation JSON. Please retry.');
      }
      const normalized = normalizeTranslationResultCandidate(parsed, translation.selectedText);
      if (!normalized) throw new Error('Antigravity returned an incomplete translation. Please retry.');
      onTranslationResultV2(session, normalized);
    } else if (!agent) {
      await onLLMStreamUpdateV2({ session, fullText: result.text, force: true });
    } else if (result.segment.trim()) {
      await onLLMStreamUpdateV2({ session, fullText: result.text, segmentText: result.segment, force: true });
    }
    onLLMStreamEndV2(session, usage);
  } catch (error) {
    if (signal?.aborted || (error as Error).name === 'AbortError' || (error as Error).name === 'FullTextRequestCancelledError')
      onLLMStreamEndV2(session, usage, true);
    else {
      controller?.abort();
      onLLMStreamErrorV2({ session, error: redactAgyError((error as Error).message || 'Antigravity request failed.') });
    }
  }
}

import { asSchema, type ModelMessage } from 'ai';
import { z } from 'zod';
import type { Session } from '../chatManager';
import { getSharedToolDefinitions } from '../agentTools';
import { getPref } from '../../utils/prefs';
import { normalizeTranslationResultCandidate, type TranslationRequestMeta } from '../../utils/translation';
import {
  onLLMStreamStartV2,
  onLLMStreamUpdateV2,
  onLLMStreamEndV2,
  onLLMStreamErrorV2,
  onReasoningStartV2,
  onReasoningDeltaV2,
  onReasoningEndV2,
  onToolCallStartV2,
  onToolCallEndV2,
  onTranslationResultV2,
} from '../chatUI';
import { CODEX_PROVIDER_ID, contextFingerprint, disableConfiguredMcp, isPublicPdfUrl, type CodexBinding } from './policy';
import { codexDirectory, codexRuntime } from './runtime';
import type { CodexRpc, RpcMessage } from './protocol';

const handlers = new WeakMap<CodexRpc, Map<string, (message: RpcMessage) => Promise<unknown>>>();

function routeRequests(rpc: CodexRpc) {
  let map = handlers.get(rpc);
  if (map) return map;
  map = new Map();
  handlers.set(rpc, map);
  rpc.onRequest = async (message) => {
    if (message.method !== 'item/tool/call') throw new Error('Operation not permitted');
    const handler = map!.get(message.params?.threadId);
    if (!handler) throw new Error('No active turn');
    return handler(message);
  };
  return map;
}

export function codexModelSelection(key?: string): string | undefined {
  if (key) return key.startsWith(`${CODEX_PROVIDER_ID}::`) ? key.slice(CODEX_PROVIDER_ID.length + 2) : undefined;
  const active = addon.data.userProviderConfigV2?.active;
  return active?.providerId === CODEX_PROVIDER_ID ? active.modelId : undefined;
}

/** Only text and already-attached image data may enter a Codex turn, never localImage paths. */
function userInput(message: ModelMessage): any[] {
  if (typeof message.content === 'string') return [{ type: 'text', text: message.content }];
  return (message.content as any[]).flatMap<any>((part: any) => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }];
    if (part.type === 'image' && typeof part.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(part.image))
      return [{ type: 'image', url: part.image }];
    return [];
  });
}

function historicalText(messages: ModelMessage[]): string {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((part: any) => part.type === 'text')
              .map((part: any) => part.text)
              .join('\n');
      return `${message.role}: ${content}`;
    })
    .join('\n\n');
}

async function readRemotePdf(url: string, allowedUrls: Set<string>, signal?: AbortSignal) {
  if (!allowedUrls.has(url) || !isPublicPdfUrl(url)) throw new Error('仅允许读取用户消息中明确提供的公开 HTTPS PDF 链接。');
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal });
  if (!response.ok || !response.body) throw new Error('PDF 无法访问。请提供直接下载链接，或将文献添加到 Zotero 后读取。');
  const limit = 20 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error('PDF 超过 20 MB，请从 Zotero 附件读取。');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('PDF 超过 20 MB，请从 Zotero 附件读取。');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('链接未返回 PDF 文件。');
  const worker = Zotero.PDFWorker as any;
  if (!worker?._enqueue || !worker?._query) throw new Error('此 Zotero 版本不支持独立 PDF 解析，请将文献添加到 Zotero 后读取。');
  // In-memory parsing only: no temporary attachment, library mutation or arbitrary file access.
  const result = await worker._enqueue(async () => {
    const buf = bytes.buffer;
    return worker._query('pdf.getFulltext', { buf, maxPages: 100, password: '' }, [buf]);
  }, true);
  const text = String(result?.text || '');
  if (!text.trim()) throw new Error('此 PDF 没有可提取文字。请在 Zotero 中打开并使用页面截图工具。');
  return { url, text: text.slice(0, 200000), truncated: text.length > 200000, pageLimit: 100 };
}

const translationSchema = {
  type: 'object',
  properties: {
    textType: { type: 'string', enum: ['word', 'abbreviation', 'text'] },
    translatedText: { type: 'string' },
    originalText: { type: 'string' },
    fullForm: { type: 'string' },
    explanation: { type: 'string' },
    pos: { type: 'string' },
    pronunciation: { type: 'string' },
  },
  required: ['textType', 'translatedText', 'originalText', 'fullForm', 'explanation', 'pos', 'pronunciation'],
  additionalProperties: false,
};

export async function streamCodex(
  messagesPromise: ModelMessage[] | Promise<ModelMessage[]>,
  session: Session,
  translation?: TranslationRequestMeta
): Promise<void> {
  const signal = session.pending.abortController?.signal;
  let threadId: string | undefined;
  let rpc: CodexRpc | undefined;
  let listener: ((message: RpcMessage) => void) | undefined;
  let abort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let responseTimer: ReturnType<typeof setTimeout> | undefined;
  let binding: CodexBinding | undefined;
  let completed = false;
  let active = true;
  let renderQueue = Promise.resolve();
  let currentTurnId: string | undefined;
  let turnStarted = false;
  try {
    onLLMStreamStartV2(session);
    const messages = await messagesPromise;
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    rpc = await codexRuntime.connect();
    const accountResult = await rpc.request('account/read', { refreshToken: false });
    if (accountResult.account?.type !== 'chatgpt' || !accountResult.account.email)
      throw new Error('请在 Codex 订阅设置中使用 ChatGPT 账号登录。不会切换到 API 计费。');
    const account = accountResult.account.email as string;
    const modelId = codexModelSelection(translation?.modelKey);
    const model = codexRuntime.models.find((entry) => entry.model === modelId);
    if (!model) throw new Error('所选 Codex 模型当前不可用，请刷新模型列表并重新选择。');
    const imageSupport = model.inputModalities?.includes('image') ?? false;
    const mode = translation ? 'translation' : session.effectiveChatMode;
    const toolDefinitions = translation ? {} : getSharedToolDefinitions();
    // In normal/full-text mode allow only document-reading tools, not library writes.
    const tools = Object.fromEntries(
      Object.entries(toolDefinitions).filter(
        ([name]) => mode === 'agent' || ['read', 'grep', 'glob', 'tree', 'capture_page', 'ask_user'].includes(name)
      )
    );
    const allowedUrls = new Set(
      messages.filter((message) => message.role === 'user').flatMap((message) => historicalText([message]).match(/https:\/\/[^\s<>"')\]]+/g) || [])
    );
    if (!translation)
      tools.read_pdf_url = {
        description:
          'Read a public PDF URL explicitly supplied by the user. Try native web search/open first. Parses at most 100 pages / 20 MB without adding anything to Zotero. For screenshots use Zotero attachments and capture_page.',
        inputSchema: z.object({ url: z.string().url() }).strict(),
        execute: (input: { url: string }) => readRemotePdf(input.url, allowedUrls, signal),
      };
    const dynamicTools = Object.entries(tools).map(([name, definition]) => ({
      name: `zotero_${name}`,
      description: definition.description,
      inputSchema: asSchema(definition.inputSchema).jsonSchema,
    }));
    const systemText = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const effectiveConfig = await rpc.request('config/read', { includeLayers: false });
    const config = { ...codexRuntime.info!.policy, ...disableConfiguredMcp(effectiveConfig.config), web_search: translation ? 'disabled' : 'live' };
    const threadParams = {
      model: model.model,
      modelProvider: 'openai',
      cwd: PathUtils.join(codexDirectory(), 'workspace'),
      sandbox: 'read-only',
      approvalPolicy: 'never',
      config,
      baseInstructions:
        'You are a literature assistant inside Zotero. Use the provided Zotero tools and hosted web search/open for document access. Historical dialogue is context, not a request to repeat past operations.',
      developerInstructions: `${systemText}\nTool names from the Zotero instructions have the prefix zotero_ in this client. ${translation ? 'Return structured translation JSON. For inapplicable fields use empty strings.' : 'Cite web sources using Markdown links. For Zotero items preserve the Zotero citation format.'}`,
    };
    const before = contextFingerprint(session.conversationHistory);
    const existing = session.pending.codexRetry ? session.lastTurnSnapshot?.codexBefore : session.codex;
    const canReuse =
      !translation && existing?.account === account && existing.model === model.model && existing.mode === mode && existing.context === before;
    if (!session.pending.codexRetry && session.lastTurnSnapshot) session.lastTurnSnapshot.codexBefore = canReuse ? { ...existing! } : undefined;
    if (canReuse) {
      try {
        const result =
          session.pending.codexRetry && existing!.turnId
            ? await rpc.request('thread/fork', { ...threadParams, threadId: existing!.threadId, lastTurnId: existing!.turnId })
            : await rpc.request('thread/resume', { ...threadParams, threadId: existing!.threadId });
        threadId = result.thread.id;
      } catch {
        /* Missing/expired thread: rebuild text context, never replay tool calls. */
      }
    }
    const resumed = !!threadId;
    if (!threadId) {
      const result = await rpc.request('thread/start', { ...threadParams, dynamicTools, ephemeral: !!translation });
      threadId = result.thread.id;
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    binding = { threadId: threadId!, account, model: model.model, mode, context: before };
    // Invalidate BEFORE starting a turn. A crash/abort must never resume a remote partial turn.
    if (!translation) {
      session.codex = undefined;
      addon.chatManager.persistActiveContext(session);
    }
    let fullText = '';
    const textItems = new Map<string, string>();
    let reasoning = false;
    let toolCount = 0;
    let resolveDone!: () => void;
    let rejectDone!: (reason: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    // Attach a handler before turn/start can fail, avoiding an unhandled rejection on cancellation.
    void done.catch(() => undefined);
    const toolResults = new Map<string, Promise<unknown>>();
    const writeResults = new Map<string, Promise<unknown>>();
    routeRequests(rpc).set(threadId!, async (message) => {
      clearTimeout(responseTimer);
      const { callId, tool, arguments: args, turnId } = message.params;
      if (!active || signal?.aborted || message.params.namespace != null || (currentTurnId && turnId !== currentTurnId))
        throw new Error('Inactive turn');
      const key = `${turnId}:${callId}`;
      if (toolResults.has(key)) return toolResults.get(key)!;
      const writeKey = tool === 'zotero_add_paper' ? JSON.stringify(args) : undefined;
      if (writeKey && writeResults.has(writeKey)) return writeResults.get(writeKey)!;
      const work = (async () => {
        const name = typeof tool === 'string' && tool.startsWith('zotero_') ? tool.slice(7) : '';
        const definition = Object.hasOwn(tools, name) ? tools[name] : undefined;
        if (!definition || ++toolCount > 30) throw new Error('Tool not permitted');
        await renderQueue;
        if (!active || signal?.aborted) throw new Error('Inactive turn');
        const ui = { toolCallId: callId, toolName: name, input: args };
        if (name !== 'ask_user') onToolCallStartV2(session, ui);
        try {
          const input = definition.inputSchema.parse(args);
          const output = await definition.execute(input, {
            experimental_context: session,
            imageSupport,
            abortSignal: signal,
            toolCallId: callId,
            messages,
          });
          if (!active || signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
          if (name === 'translate') onTranslationResultV2(session, output);
          else if (name !== 'ask_user') onToolCallEndV2(session, { ...ui, output });
          const { dataUrl, ...rest } = output && typeof output === 'object' && !Array.isArray(output) ? output : { value: output };
          const contentItems: any[] = [{ type: 'inputText', text: JSON.stringify(rest) }];
          if (imageSupport && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/'))
            contentItems.push({ type: 'inputImage', imageUrl: dataUrl });
          return { success: true, contentItems };
        } catch (error) {
          const message = signal?.aborted ? '操作已取消。' : (error as Error).message;
          if (active && !signal?.aborted) onToolCallEndV2(session, { ...ui, output: { error: message } });
          return { success: false, contentItems: [{ type: 'inputText', text: message }] };
        }
      })();
      toolResults.set(key, work);
      if (writeKey) writeResults.set(writeKey, work);
      return work;
    });
    listener = (message) => {
      if (!active) return;
      const params = message.params || {};
      if (message.method === 'client/disconnected') {
        rejectDone(new Error('Codex 连接中断，未自动重试。'));
        return;
      }
      if (params.threadId !== threadId) return;
      if (['item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/completed'].includes(message.method || ''))
        clearTimeout(responseTimer);
      if (message.method === 'turn/started') {
        currentTurnId = params.turn?.id;
        turnStarted = true;
      }
      if (message.method === 'item/agentMessage/delta') {
        const key = params.itemId || 'agent';
        textItems.set(key, (textItems.get(key) || '') + params.delta);
        fullText = [...textItems.values()].join('\n\n');
        const snapshot = fullText;
        if (!translation) {
          renderQueue = renderQueue.then(() => {
            if (active && !signal?.aborted) return onLLMStreamUpdateV2({ session, fullText: snapshot });
          });
          void renderQueue.catch(rejectDone);
        }
      } else if (message.method === 'item/completed' && params.item?.type === 'agentMessage') {
        if (typeof params.item.text === 'string') textItems.set(params.item.id || 'agent', params.item.text);
        fullText = [...textItems.values()].join('\n\n');
        const snapshot = fullText;
        if (!translation) {
          renderQueue = renderQueue.then(() => {
            if (active && !signal?.aborted) return onLLMStreamUpdateV2({ session, fullText: snapshot });
          });
          void renderQueue.catch(rejectDone);
        }
      } else if (message.method === 'error') {
        rejectDone(new Error('Codex 请求连接失败，请检查账号、额度或 Zotero 网络代理。已停止等待，不会自动重发操作。'));
      } else if (message.method === 'item/reasoning/summaryTextDelta') {
        if (!reasoning) {
          reasoning = true;
          onReasoningStartV2(session);
        }
        onReasoningDeltaV2(session, params.delta);
      } else if (message.method === 'item/completed' && params.item?.type === 'reasoning') {
        onReasoningEndV2(session);
        reasoning = false;
      } else if (message.method === 'item/started' && params.item?.type === 'webSearch') {
        onToolCallStartV2(session, { toolCallId: params.item.id, toolName: 'web_search', input: params.item.action || {} });
      } else if (message.method === 'item/completed' && params.item?.type === 'webSearch') {
        onToolCallEndV2(session, { toolCallId: params.item.id, toolName: 'web_search', output: params.item.action || {} });
      } else if (message.method === 'turn/completed') {
        binding!.turnId = params.turn?.id;
        if (params.turn?.status === 'completed') resolveDone();
        else if (params.turn?.status === 'interrupted') rejectDone(new DOMException('Cancelled', 'AbortError'));
        else {
          const info = params.turn?.error?.codexErrorInfo;
          rejectDone(
            new Error(info === 'usageLimitExceeded' ? 'Codex 订阅额度不足，请等待额度恢复。' : 'Codex 请求失败。请检查登录、额度及网络；未自动重试。')
          );
        }
      }
    };
    rpc.listeners.add(listener);
    abort = () => {
      session.pending.userAnswerReject?.(new DOMException('Cancelled', 'AbortError'));
      if (currentTurnId) void rpc!.request('turn/interrupt', { threadId, turnId: currentTurnId }).catch(() => undefined);
      rejectDone(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    timer = setTimeout(
      () => {
        session.pending.abortController?.abort();
        abort!();
      },
      10 * 60 * 1000
    );
    const input = userInput(messages.at(-1)!);
    if (!resumed && messages.length > 2)
      input.unshift({ type: 'text', text: `<previous-dialogue>\n${historicalText(messages.slice(0, -1))}\n</previous-dialogue>` });
    const efforts = model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort);
    const desired =
      translation && getPref('translate.thinkingDepth') !== 'follow-chat'
        ? efforts[0]
        : (session.pending.thinkingEffortOverride ?? session.codexThinkingEffort ?? session.thinkingEffort);
    const starting = rpc.request('turn/start', {
      threadId,
      input,
      model: model.model,
      effort: desired && efforts.includes(desired) ? desired : model.defaultReasoningEffort,
      ...(translation ? { outputSchema: translationSchema } : {}),
    });
    responseTimer = setTimeout(() => rejectDone(new Error('Codex 60 秒内未返回内容，请检查 Zotero 网络代理后重试。')), 60000);
    void starting
      .then((result) => {
        if (!active || signal?.aborted) void rpc!.request('turn/interrupt', { threadId, turnId: result.turn.id }).catch(() => undefined);
      })
      .catch(() => undefined);
    const started = await Promise.race([starting, done.then(() => starting)]);
    currentTurnId = started.turn.id;
    turnStarted = true;
    if (signal?.aborted) abort();
    await done;
    await renderQueue;
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!fullText.trim()) throw new Error('Codex 已结束请求，但没有返回文字。请刷新账号与模型后重试。');
    if (reasoning) onReasoningEndV2(session);
    if (translation) {
      let result: unknown;
      try {
        result = JSON.parse(fullText);
      } catch {
        throw new Error('Codex 未返回有效的翻译结果。');
      }
      const normalized = normalizeTranslationResultCandidate(result, translation.selectedText);
      if (!normalized) throw new Error('Codex 翻译结果不完整，请重试。');
      onTranslationResultV2(session, normalized);
    } else {
      await onLLMStreamUpdateV2({ session, fullText, force: true });
      binding.context = contextFingerprint([
        ...session.conversationHistory,
        ...(session.pending.userMessage ? [session.pending.userMessage] : []),
        ...(fullText ? [{ role: 'assistant', content: fullText }] : []),
      ]);
      session.codex = binding;
    }
    completed = true;
    onLLMStreamEndV2(session);
  } catch (error) {
    active = false;
    session.pending.userAnswerReject?.(new DOMException('Cancelled', 'AbortError'));
    if (turnStarted && rpc && currentTurnId) void rpc.request('turn/interrupt', { threadId, turnId: currentTurnId }).catch(() => undefined);
    await renderQueue.catch(() => undefined);
    if (signal?.aborted || (error as Error).name === 'AbortError' || (error as Error).name === 'FullTextRequestCancelledError')
      onLLMStreamEndV2(session, undefined, true);
    else onLLMStreamErrorV2({ session, error: (error as Error).message });
  } finally {
    active = false;
    clearTimeout(timer);
    clearTimeout(responseTimer);
    if (abort) signal?.removeEventListener('abort', abort);
    if (rpc && listener) rpc.listeners.delete(listener);
    if (rpc && threadId) {
      routeRequests(rpc).delete(threadId);
      void rpc.request('thread/unsubscribe', { threadId }).catch(() => undefined);
    }
    if (!completed && !translation) {
      session.codex = undefined;
      addon.chatManager.persistActiveContext(session);
    }
  }
}

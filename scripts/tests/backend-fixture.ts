import { z } from 'zod';
import { CodexRpc } from '../../src/modules/codex/protocol';

export const state: any = { errors: [], ends: [], updates: [], calls: [], outputs: [], reasoning: [], writes: 0 };
export function onLLMStreamStartV2(session: any) {
  session._text = '';
}
export async function onLLMStreamUpdateV2({ session, fullText }: any) {
  session._text = fullText;
  state.updates.push(fullText);
}
export function onLLMStreamEndV2(session: any, _usage?: any, aborted?: boolean) {
  if (!aborted) session.conversationHistory.push(session.pending.userMessage, { role: 'assistant', content: session._text });
  state.ends.push({ aborted });
  session.pending = {};
}
export function onLLMStreamErrorV2({ session, error }: any) {
  state.errors.push(error);
  session.pending = {};
}
export function onReasoningStartV2() {
  state.reasoning.push({ type: 'start' });
}
export function onReasoningDeltaV2(_session: any, text: string) {
  state.reasoning.push({ type: 'delta', text });
}
export function onReasoningEndV2() {
  state.reasoning.push({ type: 'end' });
}
export function onToolCallStartV2(_session: any, call: any) {
  state.calls.push(call);
}
export function onToolCallEndV2(_session: any, output: any) {
  state.outputs.push(output);
}
export function onTranslationResultV2(session: any, output: any) {
  session._text = output.translatedText;
  state.translation = output;
}
export function onAgentAskUser(session: any, payload: any) {
  state.userInputQuestions = payload.questions;
  const answers =
    state.userInputAnswers ||
    payload.questions.map((question: any) => ({
      question: question.question,
      selectedOptions: question.options?.length ? [question.options[0].label] : [],
      customInput: question.options === null ? 'Free-text answer' : undefined,
    }));
  queueMicrotask(() => session.pending.userAnswerResolve?.(answers));
}

export function getSharedToolDefinitions() {
  return {
    ask_user: { description: 'Ask', inputSchema: z.object({}), execute: async () => [] },
    read: { description: 'Read', inputSchema: z.object({ itemId: z.number().int() }), execute: async () => ({ text: 'attachment text' }) },
    add_paper: { description: 'Add', inputSchema: z.object({ doi: z.string() }), execute: async () => ({ id: ++state.writes }) },
    capture_page: {
      description: 'Image',
      inputSchema: z.object({ pageNumber: z.number().int().positive() }),
      execute: async () => ({ pageNumber: 1, dataUrl: 'data:image/png;base64,AAAA' }),
    },
  };
}

export class FakeServer {
  requests: any[] = [];
  replies: any[] = [];
  tools: { tool: string; args: any; id?: string }[] = [];
  account: any = { type: 'chatgpt', email: 'test@example.org' };
  reply = 'Hello';
  finalOnly = false;
  reasoningSummary?: string;
  webSearch = false;
  userInputQuestions?: any[];
  userInputResponse?: any;
  runtimeError?: { error: any; willRetry?: boolean };
  status = 'completed';
  disconnect = false;
  resumeFailure = false;
  onTurn?: () => void;
  private threads = 0;
  private turns = 0;
  private serverRequests = new Map<string, (message: any) => void>();
  rpc = new CodexRpc(async (text) => {
    const message = JSON.parse(text);
    if (!message.method) {
      this.replies.push(message);
      this.serverRequests.get(message.id)?.(message);
      return;
    }
    this.requests.push(message);
    let result: any = {};
    if (message.method === 'account/read') result = { account: this.account };
    else if (message.method === 'config/read') result = { config: { mcp_servers: { unwanted: { command: 'must-not-run' } } } };
    else if (message.method === 'thread/resume' && this.resumeFailure) {
      this.rpc.feed(JSON.stringify({ id: message.id, error: { code: -32600, message: 'not found' } }) + '\n');
      return;
    } else if (['thread/start', 'thread/resume', 'thread/fork'].includes(message.method))
      result = { thread: { id: message.method === 'thread/resume' ? message.params.threadId : `thread_${++this.threads}` } };
    else if (message.method === 'turn/start') {
      result = { turn: { id: `turn_${++this.turns}` } };
      this.emit('turn/started', { threadId: message.params.threadId, turn: result.turn });
      queueMicrotask(() => {
        void this.generate(message.params.threadId, result.turn.id);
      });
    }
    this.rpc.feed(JSON.stringify({ id: message.id, result }) + '\n');
  });
  emit(method: string, params: any) {
    this.rpc.feed(JSON.stringify({ method, params }) + '\n');
  }
  async generate(threadId: string, turnId: string) {
    this.onTurn?.();
    if (this.disconnect) {
      this.rpc.close();
      return;
    }
    if (this.reasoningSummary) {
      const item = { id: 'reasoning_1', type: 'reasoning', summary: [{ type: 'summary_text', text: this.reasoningSummary }] };
      this.emit('item/started', { threadId, turnId, item });
      this.emit('item/reasoning/summaryTextDelta', { threadId, turnId, itemId: item.id, delta: this.reasoningSummary });
      this.emit('item/completed', { threadId, turnId, item });
    }
    if (this.webSearch) {
      const item = { id: 'web_1', type: 'webSearch', action: { type: 'search', query: 'Codex' } };
      this.emit('item/started', { threadId, turnId, item });
      this.emit('item/completed', { threadId, turnId, item });
    }
    if (this.runtimeError) this.emit('error', { threadId, ...this.runtimeError });
    if (this.userInputQuestions) {
      const id = 'request_user_input_1';
      const reply = new Promise<any>((resolve) => this.serverRequests.set(id, resolve));
      this.rpc.feed(
        JSON.stringify({
          id,
          method: 'item/tool/requestUserInput',
          params: { threadId, turnId, itemId: 'item_user_input_1', questions: this.userInputQuestions, isBlocking: true, autoResolutionMs: null },
        }) + '\n'
      );
      this.userInputResponse = await reply;
    }
    for (const [i, tool] of this.tools.entries()) {
      const id = `request_${i}`;
      const reply = new Promise((resolve) => this.serverRequests.set(id, resolve));
      this.rpc.feed(
        JSON.stringify({
          id,
          method: 'item/tool/call',
          params: { threadId, turnId, callId: tool.id || `call_${i}`, tool: tool.tool, arguments: tool.args },
        }) + '\n'
      );
      await reply;
    }
    if (!this.finalOnly) this.emit('item/agentMessage/delta', { threadId, turnId, itemId: 'answer', delta: this.reply });
    this.emit('item/completed', { threadId, turnId, item: { id: 'answer', type: 'agentMessage', text: this.reply } });
    this.emit('turn/completed', {
      threadId,
      turn: { id: turnId, status: this.status, error: this.status === 'failed' ? { codexErrorInfo: 'usageLimitExceeded' } : null },
    });
  }
}

export const codexRuntime: any = {
  models: [
    {
      id: 'model',
      model: 'model',
      displayName: 'Model',
      inputModalities: ['text', 'image'],
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }],
      defaultReasoningEffort: 'low',
    },
  ],
  info: { policy: {} },
  connect: async () => state.server.rpc,
};
export function codexDirectory() {
  return '/isolated-codex';
}

export function resetFixture() {
  Object.assign(state, {
    errors: [],
    ends: [],
    updates: [],
    calls: [],
    outputs: [],
    reasoning: [],
    writes: 0,
    translation: undefined,
    userInputAnswers: undefined,
    userInputQuestions: undefined,
    server: new FakeServer(),
  });
  Object.assign(globalThis, {
    Zotero: { Prefs: { get: () => 'minimum' } },
    PathUtils: { join: (...parts: string[]) => parts.join('/') },
    addon: {
      data: { userProviderConfigV2: { active: { providerId: 'codex-subscription', modelId: 'model' } } },
      chatManager: { persistActiveContext: () => {} },
    },
  });
}

export function sessionFixture() {
  const session: any = {
    id: 'session',
    conversationHistory: [],
    effectiveChatMode: 'agent',
    thinkingEffort: 'none',
    lastTurnSnapshot: {},
    pending: {},
  };
  prepareTurn(session);
  return session;
}
export function prepareTurn(session: any, retry = false) {
  session.pending = { userMessage: { role: 'user', content: 'Question' }, abortController: new AbortController(), codexRetry: retry };
  if (!retry) session.lastTurnSnapshot = {};
}
export function messagesFor(session: any): any[] {
  return [{ role: 'system', content: 'Literature assistant' }, ...session.conversationHistory, session.pending.userMessage];
}

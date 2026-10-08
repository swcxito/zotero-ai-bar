import { assert } from 'chai';
import { streamCodex } from '../../src/modules/codex/backend';
import { messagesFor, prepareTurn, resetFixture, sessionFixture, state, codexRuntime } from './backend-fixture';

describe('Codex chat backend', function () {
  const counters = (inputTokens: number, outputTokens: number) => ({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens: 20,
    reasoningOutputTokens: 10,
  });

  beforeEach(function () {
    resetFixture();
  });

  afterEach(function () {
    state.server.rpc.close();
  });

  it('renders final-only messages and does not duplicate streamed text', async function () {
    state.server.finalOnly = true;
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    assert.isEmpty(state.errors);
    assert.equal(state.updates.at(-1), 'Hello');
    prepareTurn(session);
    state.server.finalOnly = false;
    await streamCodex(messagesFor(session), session);
    assert.equal(state.updates.at(-1), 'Hello');
  });

  it('reports empty completion instead of leaving an empty reply', async function () {
    state.server.reply = '';
    await streamCodex(messagesFor(sessionFixture()), sessionFixture());
    assert.include(state.errors[0], '没有返回文字');
  });

  it('reports cumulative consumption and counts all model steps once per turn', async function () {
    const session = sessionFixture();
    const first = { total: counters(100, 30), last: counters(100, 30), modelContextWindow: 200000 };
    state.server.tokenUsageUpdates = [first, first];
    await streamCodex(messagesFor(session), session);
    assert.deepEqual(state.ends[0].usage, {
      promptTokens: 100,
      completionTokens: 30,
      totalTokens: 130,
      cumulative: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
    });
    prepareTurn(session);
    state.server.tokenUsageUpdates = [
      { total: counters(250, 70), last: counters(150, 40) },
      { total: counters(450, 120), last: counters(200, 50) },
    ];
    await streamCodex(messagesFor(session), session);
    assert.deepEqual(state.ends[1].usage, {
      promptTokens: 350,
      completionTokens: 90,
      totalTokens: 440,
      cumulative: { promptTokens: 450, completionTokens: 120, totalTokens: 570 },
    });
    assert.deepEqual(session.lastUsage, state.ends[1].usage);
  });

  it('establishes a resumed thread baseline and ignores unrelated or invalid usage', async function () {
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    prepareTurn(session);
    state.server.onTurn = () => {
      state.server.emit('thread/tokenUsage/updated', { threadId: 'other', turnId: 'turn_2', tokenUsage: { total: counters(9999, 9999) } });
      state.server.emit('thread/tokenUsage/updated', { threadId: 'thread_1', turnId: 'turn_1', tokenUsage: { total: counters(9999, 9999) } });
    };
    state.server.tokenUsageUpdates = [
      { total: counters(500, 100), last: counters(200, 40) },
      { total: counters(600, 120), last: counters(100, 20) },
      { total: { totalTokens: -10 } },
      { total: { totalTokens: Infinity } },
      null,
    ];
    await streamCodex(messagesFor(session), session);
    assert.deepEqual(state.ends[1].usage, {
      promptTokens: 300,
      completionTokens: 60,
      totalTokens: 360,
      cumulative: { promptTokens: 600, completionTokens: 120, totalTokens: 720 },
    });
  });

  it('retains reported consumption on Stop and ignores late usage updates', async function () {
    const session = sessionFixture();
    const controller = session.pending.abortController;
    state.server.onTurn = () => {
      state.server.emit('thread/tokenUsage/updated', {
        threadId: 'thread_1',
        turnId: 'turn_1',
        tokenUsage: { total: counters(100, 20), last: counters(100, 20) },
      });
      assert.equal(session.lastUsage.cumulative.totalTokens, 120, 'Update before completion');
      controller.abort();
      state.server.emit('thread/tokenUsage/updated', { threadId: 'thread_1', turnId: 'turn_1', tokenUsage: { total: counters(999, 999) } });
    };
    await streamCodex(messagesFor(session), session);
    assert.isTrue(state.ends[0].aborted);
    assert.equal(state.ends[0].usage.cumulative.totalTokens, 120);
    assert.equal(session.lastUsage.cumulative.totalTokens, 120);
    assert.isEmpty(session.conversationHistory);
    state.server.onTurn = undefined;
    state.server.tokenUsageUpdates = [{ total: counters(50, 10), last: counters(50, 10) }];
    prepareTurn(session);
    await streamCodex(messagesFor(session), session);
    assert.equal(state.ends[1].usage.totalTokens, 60);
    assert.equal(state.ends[1].usage.cumulative.totalTokens, 180, 'A new remote thread must retain consumption from the stopped turn');
  });

  it('streams and persists a binding, then resumes without replaying history', async function () {
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    assert.isEmpty(state.errors);
    assert.isFalse(state.server.requests.find((r: any) => r.method === 'thread/start').params.config['mcp_servers.unwanted.enabled']);
    assert.equal(session.codex.turnId, 'turn_1');
    assert.lengthOf(session.conversationHistory, 2);
    prepareTurn(session);
    await streamCodex(messagesFor(session), session);
    assert.include(
      state.server.requests.map((r: any) => r.method),
      'thread/resume'
    );
    const turns = state.server.requests.filter((r: any) => r.method === 'turn/start');
    assert.lengthOf(turns[1].params.input, 1);
  });

  it('retries by forking before the replaced turn', async function () {
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    prepareTurn(session);
    await streamCodex(messagesFor(session), session);
    session.conversationHistory.length = 2;
    prepareTurn(session, true);
    await streamCodex(messagesFor(session), session);
    const fork = state.server.requests.find((r: any) => r.method === 'thread/fork');
    assert.equal(fork.params.lastTurnId, 'turn_1');
    assert.notEqual(session.codex.threadId, 'thread_1');
  });

  it('rebuilds missing threads and changed accounts from text, without executing historical tools', async function () {
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    state.server.resumeFailure = true;
    prepareTurn(session);
    await streamCodex(messagesFor(session), session);
    assert.equal(session.codex.threadId, 'thread_2');
    state.server.account.email = 'other@example.org';
    prepareTurn(session);
    await streamCodex(messagesFor(session), session);
    assert.equal(session.codex.account, 'other@example.org');
    assert.equal(state.writes, 0);
    const turn = state.server.requests.filter((r: any) => r.method === 'turn/start').at(-1);
    assert.include(turn.params.input[0].text, 'previous-dialogue');
  });

  it('validates tool arguments and refuses unknown tools', async function () {
    state.server.tools = [
      { tool: 'zotero_read', args: { itemId: 'invalid' } },
      { tool: 'zotero_exec_command', args: { cmd: 'must not run' } },
    ];
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    assert.isFalse(state.server.replies[0].result.success);
    assert.equal(state.server.replies[1].error.code, -32601);
    assert.equal(state.writes, 0);
  });

  it('deduplicates repeated write requests, even when the runtime changes call IDs', async function () {
    state.server.tools = [
      { tool: 'zotero_add_paper', args: { doi: '10.1/example' }, id: 'one' },
      { tool: 'zotero_add_paper', args: { doi: '10.1/example' }, id: 'two' },
    ];
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    assert.equal(state.writes, 1);
    assert.lengthOf(state.server.replies, 2);
  });

  it('normal mode exposes document readers but no library writes', async function () {
    const session = sessionFixture();
    session.effectiveChatMode = 'normal';
    state.server.tools = [{ tool: 'zotero_add_paper', args: { doi: '10.1/example' } }];
    await streamCodex(messagesFor(session), session);
    const names = state.server.requests.find((r: any) => r.method === 'thread/start').params.dynamicTools.map((t: any) => t.name);
    assert.include(names, 'zotero_read');
    assert.notInclude(names, 'zotero_add_paper');
    assert.equal(state.writes, 0);
  });

  it('Agent mode exposes the registered Zotero tools through the dynamic bridge', async function () {
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    const start = state.server.requests.find((r: any) => r.method === 'thread/start');
    const names = start.params.dynamicTools.map((t: any) => t.name);
    assert.includeMembers(names, ['zotero_read', 'zotero_add_paper', 'zotero_capture_page']);
    assert.notInclude(names, 'zotero_ask_user');
    assert.include(start.params.developerInstructions, 'Codex-native request_user_input tool is not prefixed');
  });

  it('handles native request_user_input with choices and free text', async function () {
    state.server.userInputQuestions = [
      {
        id: 'scope',
        header: 'Scope',
        question: 'Which scope should be used?',
        options: [
          { label: 'Current item', description: 'Use only the open item.' },
          { label: 'Library', description: 'Search the whole library.' },
        ],
        isOther: true,
        isSecret: false,
      },
      {
        id: 'topic',
        header: 'Topic',
        question: 'What topic should be searched?',
        options: null,
        isOther: false,
        isSecret: false,
      },
    ];
    state.userInputAnswers = [
      { question: 'Which scope should be used?', selectedOptions: ['Library'] },
      { question: 'What topic should be searched?', selectedOptions: [], customInput: 'Memory consolidation' },
    ];
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    assert.deepEqual(state.userInputQuestions[0].options[1], {
      label: 'Library',
      description: 'Search the whole library.',
    });
    assert.deepEqual(state.server.userInputResponse.result, {
      answers: {
        scope: { answers: ['Library'] },
        topic: { answers: ['Memory consolidation'] },
      },
    });
  });

  it('renders reasoning summaries before hosted web search and the final reply', async function () {
    state.server.reasoningSummary = '先搜索相关信息，再整理答案。';
    state.server.webSearch = true;
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    assert.deepInclude(state.reasoning, { type: 'delta', text: '先搜索相关信息，再整理答案。' });
    assert.equal(state.reasoning.at(-1).type, 'end');
    assert.equal(state.calls[0].toolName, 'web_search');
    assert.equal(state.updates.at(-1), 'Hello');
  });

  it('waits through transient app-server errors and exposes permanent diagnostics', async function () {
    state.server.runtimeError = { error: { codexErrorInfo: 'networkError', message: 'temporary upstream failure' }, willRetry: true };
    let session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    assert.isEmpty(state.errors);
    assert.equal(state.updates.at(-1), 'Hello');

    state.errors.length = 0;
    state.server.runtimeError = { error: { codexErrorInfo: 'invalidRequest', message: 'host is disabled', httpStatusCode: 400 } };
    session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    assert.include(state.errors[0], 'invalidRequest');
    assert.include(state.errors[0], 'host is disabled');
    assert.include(state.errors[0], '400');
  });

  it('returns PDF page images through dynamic tool content, never a local path', async function () {
    state.server.tools = [{ tool: 'zotero_capture_page', args: { pageNumber: 1 } }];
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    assert.equal(state.server.replies[0].result.contentItems[1].type, 'inputImage');
    assert.match(state.server.replies[0].result.contentItems[1].imageUrl, /^data:image/);
  });

  it('translation uses a standalone structured turn without tools or web search', async function () {
    state.server.reply = JSON.stringify({ textType: 'text', translatedText: '你好' });
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session, { selectedText: 'Hello', targetLanguage: 'zh', modelKey: 'codex-subscription::model' } as any);
    assert.equal(state.translation.translatedText, '你好');
    assert.isUndefined(session.codex);
    const start = state.server.requests.find((r: any) => r.method === 'thread/start');
    assert.isTrue(start.params.ephemeral);
    assert.isEmpty(start.params.dynamicTools);
    assert.equal(start.params.config.web_search, 'disabled');
    assert.isDefined(state.server.requests.find((r: any) => r.method === 'turn/start').params.outputSchema);
  });

  it('does not fall back to an API key, unavailable model or another account', async function () {
    state.server.account = { type: 'apiKey' };
    const session = sessionFixture();
    await streamCodex(messagesFor(session), session);
    assert.include(state.errors[0], 'ChatGPT');
    assert.notInclude(
      state.server.requests.map((r: any) => r.method),
      'turn/start'
    );
  });

  it('cancellation interrupts without persisting partial output or executing queued writes', async function () {
    const session = sessionFixture();
    state.server.onTurn = () => session.pending.abortController.abort();
    state.server.tools = [{ tool: 'zotero_add_paper', args: { doi: '10.1/example' } }];
    await streamCodex(messagesFor(session), session);
    assert.isUndefined(session.codex);
    assert.isEmpty(session.conversationHistory);
    assert.equal(state.writes, 0);
    assert.isTrue(state.ends[0].aborted);
    assert.include(
      state.server.requests.map((r: any) => r.method),
      'turn/interrupt'
    );
  });

  it('stops during reasoning without waiting for a final answer and ignores late events', async function () {
    const session = sessionFixture();
    const controller = session.pending.abortController;
    let reasoningStarted!: () => void;
    const ready = new Promise<void>((resolve) => (reasoningStarted = resolve));
    state.server.generate = async (threadId: string, turnId: string) => {
      state.server.emit('item/started', { threadId, turnId, item: { id: 'thinking', type: 'reasoning', summary: [] } });
      state.server.emit('item/reasoning/summaryTextDelta', { threadId, turnId, delta: 'Still thinking' });
      reasoningStarted();
    };
    const request = streamCodex(messagesFor(session), session);
    await ready;
    assert.equal(state.reasoning.at(-1).text, 'Still thinking');
    controller.abort();
    state.server.emit('item/reasoning/summaryTextDelta', { threadId: 'thread_1', turnId: 'turn_1', delta: 'Late reasoning' });
    await request;
    assert.isTrue(state.ends[0].aborted);
    assert.isEmpty(state.errors);
    assert.isEmpty(session.pending);
    assert.isEmpty(session.conversationHistory);
    assert.isUndefined(session.codex);
    assert.notInclude(
      state.reasoning.map((part: any) => part.text),
      'Late reasoning'
    );
    assert.isEmpty(state.updates);
    assert.isDefined(state.server.requests.find((r: any) => r.method === 'turn/interrupt' && r.params.turnId === 'turn_1'));
    state.server.generate = Object.getPrototypeOf(state.server).generate;
    prepareTurn(session);
    await streamCodex(messagesFor(session), session);
    assert.equal(state.updates.at(-1), 'Hello', 'A fresh turn must work after Stop');
  });

  it('clears bindings on disconnection and does not replay turn/start', async function () {
    const session = sessionFixture();
    state.server.disconnect = true;
    await streamCodex(messagesFor(session), session);
    assert.isUndefined(session.codex);
    assert.lengthOf(state.errors, 1);
    assert.lengthOf(
      state.server.requests.filter((r: any) => r.method === 'turn/start'),
      1
    );
  });

  it('reports quota errors and chooses only runtime-supported reasoning efforts', async function () {
    const session = sessionFixture();
    session.codexThinkingEffort = 'ultra';
    state.server.status = 'failed';
    await streamCodex(messagesFor(session), session);
    assert.include(state.errors[0], '额度不足');
    assert.isUndefined(session.codex);
    assert.equal(state.server.requests.find((r: any) => r.method === 'turn/start').params.effort, codexRuntime.models[0].defaultReasoningEffort);
  });
});

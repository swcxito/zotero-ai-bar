import { assert } from 'chai';
import { streamCodex } from '../../src/modules/codex/backend';
import { messagesFor, prepareTurn, resetFixture, sessionFixture, state, codexRuntime } from './backend-fixture';

describe('Codex chat backend', function () {
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

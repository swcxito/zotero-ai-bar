import { assert } from 'chai';
import { Session } from '../../src/modules/chatManager';
import { renderPersistedTranscript } from '../../src/modules/chatUI';
import { ChatHistoryStore, type PersistedTurn } from '../../src/modules/chatHistoryStore';

describe('History transcript rendering in real Zotero', function () {
  let container: HTMLElement;
  let session: Session;

  before(function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    (globalThis as any).addon = (Zotero as any).ZAIBar;
    (globalThis as any).ztoolkit = addon.data.ztoolkit;
  });

  beforeEach(function () {
    const doc = Zotero.getMainWindow().document;
    container = doc.createElement('div');
    doc.documentElement.appendChild(container);
    session = new Session('history-render-test', { kind: 'global-agent' });
    session.conversationId = 'history-render-conversation';
    session.persistedTurns = [turn('first'), turn('second')];
  });

  afterEach(function () {
    container.remove();
  });

  function turn(id: string): PersistedTurn {
    return { id, createdAt: 1, userText: `Question ${id}`, assistantMarkdown: `Answer ${id}` };
  }

  function answers() {
    return [...container.querySelectorAll<HTMLElement>('[data-markdown]')].map((node) => node.dataset.markdown);
  }

  it('renders each reply once when automatic refresh and forced history activation overlap', async function () {
    // Activation notifies workspace subscribers before onActivate forces a render.
    await Promise.all([renderPersistedTranscript(session, container), renderPersistedTranscript(session, container, true)]);
    assert.deepEqual(answers(), ['Answer first', 'Answer second']);
    assert.lengthOf(container.querySelectorAll('[data-chat-role="user"]'), 2);
  });

  it('never appends an old reply after switching conversations during Markdown rendering', async function () {
    const oldRender = renderPersistedTranscript(session, container);
    session.conversationId = 'new-conversation';
    session.persistedTurns = [turn('new')];
    const newRender = renderPersistedTranscript(session, container);
    await Promise.all([oldRender, newRender]);
    assert.deepEqual(answers(), ['Answer new']);
    assert.notInclude(container.textContent!, 'Question first');
  });

  it('does not replay a newly saved live reply while restoring older turns', async function () {
    const rendering = renderPersistedTranscript(session, container);
    session.persistedTurns.push(turn('live'));
    const liveReply = container.ownerDocument.createElement('div');
    liveReply.dataset.markdown = 'Answer live';
    container.appendChild(liveReply);
    await rendering;
    assert.equal(answers().filter((text) => text === 'Answer live').length, 1);
  });

  it('cancels pending replies when a new conversation clears the container', async function () {
    const rendering = renderPersistedTranscript(session, container);
    session.conversationId = 'empty-conversation';
    container.replaceChildren();
    container.dataset.conversationId = session.conversationId;
    await rendering;
    assert.lengthOf(container.children, 0);
  });

  it('restores one copy per turn after writing and reading the actual history file', async function () {
    const store = new ChatHistoryStore();
    await store.initialize();
    const id = `history-roundtrip-${Date.now()}`;
    try {
      store.upsert({
        id,
        scope: 'global-agent',
        kind: 'global-agent',
        title: 'Transcript roundtrip',
        favorite: false,
        createdAt: Date.now(),
        lastMessageAt: Date.now(),
        turns: session.persistedTurns,
        contextMessages: [],
      });
      await store.flush();
      const restored = new ChatHistoryStore();
      await restored.initialize();
      session.conversationId = id;
      session.persistedTurns = restored.get(id)!.turns;
      await Promise.all([renderPersistedTranscript(session, container), renderPersistedTranscript(session, container, true)]);
      assert.deepEqual(answers(), ['Answer first', 'Answer second']);
      assert.lengthOf(restored.get(id)!.turns, 2);
    } finally {
      store.delete(id);
      await store.flush();
    }
  });
});

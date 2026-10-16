import { assert } from 'chai';
import { ChatHistoryStore, type PersistedConversation } from '../../src/modules/chatHistoryStore';

describe('history write coalescing', function () {
  const scope = globalThis as any;
  let originals: Record<string, any>;
  let writes: any[];
  let write: (data: any) => Promise<void>;

  beforeEach(function () {
    originals = Object.fromEntries(['PathUtils', 'IOUtils', 'addon', 'ztoolkit'].map((key) => [key, scope[key]]));
    writes = [];
    write = async (data) => {
      writes.push(structuredClone(data));
    };
    scope.PathUtils = { profileDir: '/fixture', join: (...parts: string[]) => parts.join('/') };
    scope.addon = { data: { config: { addonRef: 'fixture' } } };
    scope.ztoolkit = { log() {} };
    scope.IOUtils = { makeDirectory: async () => {}, writeJSON: async (_path: string, data: any) => write(data) };
  });

  afterEach(function () {
    for (const [key, value] of Object.entries(originals)) scope[key] = value;
  });
  function seed(store: ChatHistoryStore) {
    store.upsert({
      id: 'c',
      scope: 'global-agent',
      kind: 'global-agent',
      title: 'initial',
      favorite: false,
      createdAt: 1,
      lastMessageAt: 1,
      turns: [],
      contextMessages: [],
    } as PersistedConversation);
  }

  it('merges a synchronous burst into one durable final snapshot', async function () {
    const store = new ChatHistoryStore();
    seed(store);
    for (let i = 0; i < 20; i++) store.rename('c', `title-${i}`);
    await store.flush();
    assert.lengthOf(writes, 1);
    assert.equal(writes[0].conversations[0].title, 'title-19');
  });

  it('flush waits for one follow-up snapshot when changes arrive during a write', async function () {
    const store = new ChatHistoryStore();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    write = async (data) => {
      writes.push(structuredClone(data));
      if (writes.length === 1) {
        entered();
        await gate;
      }
    };
    seed(store);
    await started;
    const flushing = store.flush();
    for (let i = 0; i < 20; i++) store.rename('c', `late-${i}`);
    release();
    await flushing;
    assert.lengthOf(writes, 2);
    assert.equal(writes[1].conversations[0].title, 'late-19');
  });
});

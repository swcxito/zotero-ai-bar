import { assert } from 'chai';
import {
  ChatHistoryStore,
  MAX_REGULAR_CONVERSATIONS,
  MAX_REGULAR_TURNS,
  makeConversationTitle,
  mergeHistoryFiles,
  normalizeTextContext,
  pruneHistory,
  rebindPortableHistoryFile,
  preparePortableItemIndex,
  resolveLocalItemIdForConversation,
  sanitizeHistoryFile,
  type PersistedChatHistoryFile,
  type PersistedConversation,
} from '../src/modules/chatHistoryStore';
import {
  encodeBasicAuth,
  mergeProviderConfigs,
  mergeSyncPayloads,
  normalizeWebDavEndpoint,
  resetWebDavSyncStateForTests,
  sanitizeProviderConfigForSync,
  syncWithWebDav,
  testWebDavConnection,
  WEBDAV_SYNC_SCHEMA,
  type WebDavSyncPayload,
} from '../src/modules/webdavSync';
import { getPref, setPref } from '../src/utils/prefs';

function conversation(index: number, favorite = false, turnCount = 1): PersistedConversation {
  return {
    id: `conversation-${index}`,
    scope: `article:${index}`,
    kind: 'article',
    itemId: index,
    title: `Conversation ${index}`,
    favorite,
    createdAt: index,
    lastMessageAt: index,
    turns: Array.from({ length: turnCount }, (_, turn) => ({
      id: `turn-${index}-${turn}`,
      createdAt: turn,
      userText: `Question ${turn}`,
      assistantMarkdown: `Answer ${turn}`,
    })),
    contextMessages: [],
  };
}

describe('chatHistoryStore', function () {
  it('keeps favorites outside the regular conversation limit', function () {
    const favorite = conversation(999, true);
    const file: PersistedChatHistoryFile = {
      version: 2,
      activeByScope: {},
      conversations: [favorite, ...Array.from({ length: MAX_REGULAR_CONVERSATIONS + 2 }, (_, index) => conversation(index))],
    };
    pruneHistory(file);
    assert.equal(file.conversations.filter((entry) => !entry.favorite).length, MAX_REGULAR_CONVERSATIONS);
    assert.include(file.conversations, favorite);
    assert.notInclude(
      file.conversations.map((entry) => entry.id),
      'conversation-0'
    );
  });

  it('trims regular turns but leaves favorite conversations intact', function () {
    const regular = conversation(1, false, MAX_REGULAR_TURNS + 5);
    const favorite = conversation(2, true, MAX_REGULAR_TURNS + 5);
    const file: PersistedChatHistoryFile = { version: 2, activeByScope: {}, conversations: [regular, favorite] };
    pruneHistory(file);
    assert.lengthOf(regular.turns, MAX_REGULAR_TURNS);
    assert.lengthOf(favorite.turns, MAX_REGULAR_TURNS + 5);
  });

  it('keeps only text user/assistant context and respects round limits', function () {
    const messages: any[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'old' },
          { type: 'image', image: 'data:image/png;base64,SECRET' },
        ],
      },
      { role: 'assistant', content: 'old answer' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: '1' }] },
      { role: 'tool', content: [{ type: 'tool-result', output: 'SECRET TOOL RESULT' }] },
      { role: 'user', content: 'new' },
      { role: 'assistant', content: 'new answer' },
    ];
    const result = normalizeTextContext(messages, 1);
    assert.deepEqual(result, [
      { role: 'user', content: 'new' },
      { role: 'assistant', content: 'new answer' },
    ]);
    assert.notInclude(JSON.stringify(result), 'SECRET');
  });

  it('rejects newer file versions without treating them as corruption', function () {
    assert.equal(sanitizeHistoryFile({ version: 3, conversations: [] }), 'unsupported');
    assert.isNull(sanitizeHistoryFile({ version: 0, conversations: [] }));
  });

  it('keeps optional reference text while accepting legacy turns without it', function () {
    const current = conversation(1);
    current.turns[0].referenceText = 'Quoted selection';
    const legacy = conversation(2);
    const sanitized = sanitizeHistoryFile({ version: 1, activeByScope: {}, conversations: [current, legacy] });
    assert.notEqual(sanitized, null);
    assert.notEqual(sanitized, 'unsupported');
    if (!sanitized || sanitized === 'unsupported') return;
    assert.equal(sanitized.conversations[0].turns[0].referenceText, 'Quoted selection');
    assert.isUndefined(sanitized.conversations[1].turns[0].referenceText);
  });

  it('migrates v1 history to v2 without losing conversations', function () {
    const legacy = conversation(7);
    const sanitized = sanitizeHistoryFile({ version: 1, activeByScope: { 'article:7': legacy.id }, conversations: [legacy] });
    assert.notEqual(sanitized, null);
    assert.notEqual(sanitized, 'unsupported');
    if (!sanitized || sanitized === 'unsupported') return;
    assert.equal(sanitized.version, 2);
    assert.equal(sanitized.conversations[0].turns[0].userText, 'Question 0');
  });

  it('restores a valid v2 checkpoint and recent tail', function () {
    const current = conversation(8);
    current.checkpoint = {
      summary: 'frozen summary',
      coveredThroughTurnId: 'turn-8-0',
      createdAt: 123,
      recentTail: [{ role: 'user', content: 'recent question' } as any],
    };
    const sanitized = sanitizeHistoryFile({ version: 2, activeByScope: {}, conversations: [current] });
    assert.notEqual(sanitized, null);
    assert.notEqual(sanitized, 'unsupported');
    if (!sanitized || sanitized === 'unsupported') return;
    assert.equal(sanitized.conversations[0].checkpoint?.summary, 'frozen summary');
    assert.equal((sanitized.conversations[0].checkpoint?.recentTail[0] as any).content, 'recent question');
  });

  it('builds a compact title from the first available visible body', function () {
    assert.equal(makeConversationTitle('  My   question  ', 'answer', 'New conversation'), 'My question');
    assert.equal(makeConversationTitle(undefined, '**Markdown** answer', 'New conversation'), 'Markdown answer');
  });

  it('rebinds portable itemKey across machines and isolates unsynced items with negative itemId', function () {
    const convSynced: PersistedConversation = {
      ...conversation(42),
      id: 'conv-synced',
      itemKey: 'KEY_SYNCED',
      libraryType: 'user',
    };
    const convUnsynced: PersistedConversation = {
      ...conversation(43),
      id: 'conv-unsynced',
      itemKey: 'KEY_PENDING',
      libraryType: 'user',
    };
    const file: PersistedChatHistoryFile = {
      version: 2,
      activeByScope: {
        'article:42': 'conv-synced',
        'article:43': 'conv-unsynced',
      },
      conversations: [convSynced, convUnsynced],
    };

    const mockZoteroOnMachineB = {
      Libraries: { userLibraryID: 1 },
      Items: {
        getByLibraryAndKey(libId: number, key: string) {
          if (libId === 1 && key === 'KEY_SYNCED') return { id: 888, key: 'KEY_SYNCED' };
          return false;
        },
        get(_id: number) {
          return null;
        },
      },
    };

    const changed = rebindPortableHistoryFile(file, mockZoteroOnMachineB);
    assert.isTrue(changed);
    assert.equal(convSynced.itemId, 888);
    assert.equal(convSynced.scope, 'article:888');
    assert.equal(file.activeByScope['article:888'], 'conv-synced');
    assert.isBelow(convUnsynced.itemId!, 0);
    assert.match(convUnsynced.scope, /^article:-\d+$/);
  });

  it('respects deletion tombstones and merges turns across machines', function () {
    const baseConv = {
      ...conversation(10),
      id: 'conv-shared',
      itemKey: 'ITEM_ABC',
      libraryType: 'user' as const,
      lastMessageAt: 100,
    };
    const toBeDeleted = {
      ...conversation(20),
      id: 'conv-deleted',
      itemKey: 'ITEM_DEL',
      libraryType: 'user' as const,
      lastMessageAt: 90,
    };
    const localFile: PersistedChatHistoryFile = {
      version: 2,
      activeByScope: { 'article:10': 'conv-shared' },
      conversations: [baseConv, toBeDeleted],
      deletedConversations: {},
    };
    const remoteConv = {
      ...baseConv,
      itemId: 555,
      scope: 'article:555' as const,
      lastMessageAt: 200,
      turns: [
        ...baseConv.turns,
        {
          id: 'turn-remote-2',
          createdAt: 200,
          userText: 'Follow-up on Machine B',
          assistantMarkdown: 'Reply on Machine B',
        },
      ],
    };
    const remoteFile: PersistedChatHistoryFile = {
      version: 2,
      activeByScope: { 'article:555': 'conv-shared' },
      conversations: [remoteConv],
      deletedConversations: { 'conv-deleted': 150 },
    };

    const mockZoteroOnMachineA = {
      Libraries: { userLibraryID: 1 },
      Items: {
        getByLibraryAndKey(_libId: number, key: string) {
          if (key === 'ITEM_ABC') return { id: 10, key: 'ITEM_ABC' };
          return false;
        },
        get(id: number) {
          if (id === 10) return { id: 10, key: 'ITEM_ABC', libraryID: 1 };
          return null;
        },
      },
    };

    const result = mergeHistoryFiles(localFile, remoteFile, mockZoteroOnMachineA);
    assert.equal(result.deleted, 1);
    assert.equal(result.updated, 1);
    assert.lengthOf(result.merged.conversations, 1);
    assert.equal(result.merged.conversations[0].id, 'conv-shared');
    assert.equal(result.merged.conversations[0].itemId, 10);
    assert.equal(result.merged.conversations[0].scope, 'article:10');
    assert.lengthOf(result.merged.conversations[0].turns, 2);
  });

  it('normalizes WebDAV URLs and strips API keys when includeApiKeys is false', function () {
    const { folderUrl, fileUrl } = normalizeWebDavEndpoint('https://dav.jianguoyun.com/dav/', '/zotero-ai-bar/');
    assert.equal(folderUrl, 'https://dav.jianguoyun.com/dav/zotero-ai-bar/');
    assert.equal(fileUrl, 'https://dav.jianguoyun.com/dav/zotero-ai-bar/zaibar-sync-v1.json');
    assert.equal(encodeBasicAuth('user@example.com', 'secret123'), 'Basic dXNlckBleGFtcGxlLmNvbTpzZWNyZXQxMjM=');

    const v2: any = {
      active: { providerId: 'openai', modelId: 'gpt-4o' },
      env: { openai: { OPENAI_API_KEY: 'sk-secret' } },
      recentUsed: [],
      addedProviders: {},
      addedModels: [],
    };
    const stripped = sanitizeProviderConfigForSync(v2, false);
    assert.deepEqual(stripped?.env, {});
    const mergedV2 = mergeProviderConfigs(v2, stripped, false);
    assert.equal(mergedV2?.env.openai.OPENAI_API_KEY, 'sk-secret');

    const { mergedPayload } = mergeSyncPayloads(
      {
        schema: WEBDAV_SYNC_SCHEMA,
        exportedAt: 100,
        chatHistory: { version: 2, activeByScope: {}, conversations: [] },
        providerConfigV2: v2,
      },
      {
        schema: WEBDAV_SYNC_SCHEMA,
        exportedAt: 200,
        chatHistory: { version: 2, activeByScope: {}, conversations: [] },
        providerConfigV2: stripped,
      },
      { includeApiKeys: false }
    );
    assert.deepEqual(mergedPayload.providerConfigV2?.env, {});
  });

  it('preserves conversation rename and favorite changes via updatedAt when lastMessageAt is unchanged', function () {
    const store = new ChatHistoryStore() as any;
    store.readOnly = true;
    const base = {
      ...conversation(1, false, 1),
      id: 'conv-rename-fav',
      createdAt: 100,
      lastMessageAt: 100,
      updatedAt: 100,
    };
    store.upsert(base);
    const initialUpdatedAt = store.get('conv-rename-fav').updatedAt;

    store.rename('conv-rename-fav', 'Renamed Locally');
    store.setFavorite('conv-rename-fav', true);
    const localSnapshot = store.getSnapshot();
    const localConv = localSnapshot.conversations[0];
    assert.isAbove(localConv.updatedAt!, initialUpdatedAt);
    assert.equal(localConv.lastMessageAt, 100);

    const staleRemote: PersistedChatHistoryFile = {
      version: 2,
      activeByScope: { 'article:1': 'conv-rename-fav' },
      conversations: [
        {
          ...base,
          title: 'Old Remote Title',
          favorite: false,
          lastMessageAt: 100,
          updatedAt: 100,
        },
      ],
    };

    const mergedFromLocal = mergeHistoryFiles(localSnapshot, staleRemote);
    assert.equal(mergedFromLocal.merged.conversations[0].title, 'Renamed Locally');
    assert.isTrue(mergedFromLocal.merged.conversations[0].favorite);

    const mergedFromRemote = mergeHistoryFiles(staleRemote, localSnapshot);
    assert.equal(mergedFromRemote.merged.conversations[0].title, 'Renamed Locally');
    assert.isTrue(mergedFromRemote.merged.conversations[0].favorite);
  });

  it('retains the checkpoint summary in contextMessages when merging concurrent turns after compaction', async function () {
    const prevZotero = (globalThis as any).Zotero;
    try {
      (globalThis as any).Zotero = {
        debug: () => {},
        Utilities: {
          randomString: () => 'abcdefghij',
        },
        Prefs: {
          get: () => 5,
          set: () => {},
        },
      };
      const { createCheckpointMessage } = await import('../src/modules/contextCompaction');
      const { ChatManager } = await import('../src/modules/chatManager');

      const summaryText = 'Compacted summary of turn-0';
      const checkpointMsg = createCheckpointMessage(summaryText);
      const turn0 = {
        id: 'turn-0',
        createdAt: 100,
        userText: 'Q0',
        assistantMarkdown: 'A0',
      };
      const turnA = {
        id: 'turn-A',
        createdAt: 200,
        userText: 'Q from Device A',
        assistantMarkdown: 'A from Device A',
      };
      const turnB = {
        id: 'turn-B',
        createdAt: 300,
        userText: 'Q from Device B',
        assistantMarkdown: 'A from Device B',
      };

      const localFile: PersistedChatHistoryFile = {
        version: 2,
        activeByScope: { 'global-agent': 'conv-ckpt' },
        conversations: [
          {
            id: 'conv-ckpt',
            scope: 'global-agent',
            kind: 'global-agent',
            title: 'Compacted Conv',
            favorite: false,
            createdAt: 100,
            lastMessageAt: 200,
            updatedAt: 200,
            turns: [turn0, turnA],
            checkpoint: {
              summary: summaryText,
              coveredThroughTurnId: 'turn-0',
              createdAt: 150,
              recentTail: [
                { role: 'user', content: 'Q from Device A' },
                { role: 'assistant', content: 'A from Device A' },
              ],
            },
            contextMessages: [checkpointMsg, { role: 'user', content: 'Q from Device A' }, { role: 'assistant', content: 'A from Device A' }],
          },
        ],
      };

      const remoteFile: PersistedChatHistoryFile = {
        version: 2,
        activeByScope: { 'global-agent': 'conv-ckpt' },
        conversations: [
          {
            id: 'conv-ckpt',
            scope: 'global-agent',
            kind: 'global-agent',
            title: 'Compacted Conv',
            favorite: false,
            createdAt: 100,
            lastMessageAt: 300,
            updatedAt: 300,
            turns: [turn0, turnB],
            checkpoint: {
              summary: summaryText,
              coveredThroughTurnId: 'turn-0',
              createdAt: 150,
              recentTail: [
                { role: 'user', content: 'Q from Device B' },
                { role: 'assistant', content: 'A from Device B' },
              ],
            },
            contextMessages: [checkpointMsg, { role: 'user', content: 'Q from Device B' }, { role: 'assistant', content: 'A from Device B' }],
          },
        ],
      };

      const { merged } = mergeHistoryFiles(localFile, remoteFile);
      const mergedConv = merged.conversations[0];
      assert.isDefined(mergedConv.checkpoint);
      assert.deepEqual(
        mergedConv.checkpoint!.recentTail.map((m: any) => m.content),
        ['Q from Device A', 'A from Device A', 'Q from Device B', 'A from Device B']
      );
      assert.deepEqual(
        mergedConv.contextMessages.map((m: any) => m.content),
        [checkpointMsg.content, 'Q from Device A', 'A from Device A', 'Q from Device B', 'A from Device B']
      );

      const cm = new ChatManager('tab-ckpt') as any;
      cm.historyStore.readOnly = true;
      const session: any = { id: 'global-agent', kind: 'global-agent', pending: {} };
      cm.hydrateSession(session, mergedConv);
      assert.deepEqual(
        session.conversationHistory.map((m: any) => m.content),
        [checkpointMsg.content, 'Q from Device A', 'A from Device A', 'Q from Device B', 'A from Device B']
      );
    } finally {
      (globalThis as any).Zotero = prevZotero;
    }
  });

  it('does not lose remotely synced turns when a reply finishes generating in the same conversation', async function () {
    const prevZotero = (globalThis as any).Zotero;
    try {
      (globalThis as any).Zotero = {
        debug: () => {},
        Utilities: {
          randomString: () => 'abcdefghij',
        },
        Prefs: {
          get: () => 5,
          set: () => {},
        },
      };
      const { ChatManager } = await import('../src/modules/chatManager');
      const cm = new ChatManager('tab-test') as any;
      cm.historyStore.readOnly = true;

      const initialConv: PersistedConversation = {
        id: 'conv-streaming',
        scope: 'global-agent',
        kind: 'global-agent',
        title: 'Initial',
        favorite: false,
        createdAt: 100,
        lastMessageAt: 100,
        updatedAt: 100,
        turns: [
          {
            id: 'turn-1',
            createdAt: 100,
            userText: 'Q1',
            assistantMarkdown: 'A1',
          },
        ],
        contextMessages: [],
      };
      cm.historyStore.upsert(initialConv);

      const session: any = {
        id: 'global-agent',
        kind: 'global-agent',
        conversationId: 'conv-streaming',
        conversationTitle: 'Initial',
        favorite: false,
        conversationCreatedAt: 100,
        conversationLastMessageAt: 100,
        persistedTurns: [...initialConv.turns],
        persistedContextMessages: [
          { role: 'user', content: 'Q1' },
          { role: 'assistant', content: 'A1' },
        ],
        conversationHistory: [
          { role: 'user', content: 'Q1' },
          { role: 'assistant', content: 'A1' },
        ],
        pending: {
          abortController: new AbortController(),
          displayUserText: 'Q3 (local streaming)',
        },
      };
      cm.sessionsMap.set('global-agent', session);

      const remoteHistory: PersistedChatHistoryFile = {
        version: 2,
        activeByScope: { 'global-agent': 'conv-streaming' },
        conversations: [
          {
            ...initialConv,
            title: 'Remote Renamed',
            favorite: true,
            lastMessageAt: 200,
            updatedAt: 200,
            turns: [
              ...initialConv.turns,
              {
                id: 'turn-2-remote',
                createdAt: 200,
                userText: 'Q2 from Machine B',
                assistantMarkdown: 'A2 from Machine B',
              },
            ],
            contextMessages: [
              { role: 'user', content: 'Q1' },
              { role: 'assistant', content: 'A1' },
              { role: 'user', content: 'Q2 from Machine B' },
              { role: 'assistant', content: 'A2 from Machine B' },
            ],
          },
        ],
      };

      cm.applyRemoteHistoryMerge(remoteHistory);

      // In-flight conversationHistory is not mutated while streaming
      assert.deepEqual(
        session.conversationHistory.map((m: any) => m.content),
        ['Q1', 'A1']
      );

      // Streaming finishes and appends Q3 / A3 before recordCompletedTurn
      session.pending.abortController = undefined;
      session.conversationHistory.push({ role: 'user', content: 'Q3 (local streaming)' }, { role: 'assistant', content: 'A3 (local streaming)' });
      cm.recordCompletedTurn(session, 'A3 (local streaming)', false);

      const saved = cm.historyStore.get('conv-streaming');
      assert.isDefined(saved);
      assert.equal(saved.title, 'Remote Renamed');
      assert.isTrue(saved.favorite);
      assert.deepEqual(
        saved.turns.map((t: any) => t.userText),
        ['Q1', 'Q2 from Machine B', 'Q3 (local streaming)']
      );
      const expectedContextContents = ['Q1', 'A1', 'Q2 from Machine B', 'A2 from Machine B', 'Q3 (local streaming)', 'A3 (local streaming)'];
      assert.deepEqual(
        saved.contextMessages.map((m: any) => m.content),
        expectedContextContents
      );
      assert.deepEqual(
        session.conversationHistory.map((m: any) => m.content),
        expectedContextContents
      );
    } finally {
      (globalThis as any).Zotero = prevZotero;
    }
  });

  it('syncs updated prompts, deleted prompts, modified models/API keys, and remote settings across devices', async function () {
    const prevZotero = (globalThis as any).Zotero;
    const prevAddon = (globalThis as any).addon;
    try {
      let cloudFileText = '';
      const mockFetch = (async (_url: string, init?: RequestInit) => {
        const method = (init?.method || 'GET').toUpperCase();
        if (method === 'PROPFIND' || method === 'MKCOL') {
          return { status: 200, text: async () => '' } as any;
        }
        if (method === 'PUT') {
          cloudFileText = String(init?.body ?? '');
          return { status: 204, text: async () => '' } as any;
        }
        if (method === 'GET') {
          if (!cloudFileText) return { status: 404, text: async () => '' } as any;
          return { status: 200, headers: { get: () => '"v1"' }, text: async () => cloudFileText } as any;
        }
        return { status: 500, text: async () => '' } as any;
      }) as typeof fetch;

      const createDeviceState = (promptText: string, apiKey: string, modelName: string, activeModelId: string) => {
        const prefs = new Map<string, any>();
        const deviceAddon: any = {
          data: {
            config: { addonRef: 'zaibar' },
            userPrompts: [
              { id: 'p-edit', name: 'Summary', content: promptText },
              { id: 'p-delete', name: 'Obsolete', content: 'Delete me' },
            ],
            userProviderConfigV2: {
              active: { providerId: 'openai', modelId: activeModelId },
              env: { openai: { OPENAI_API_KEY: apiKey } },
              recentUsed: [{ providerId: 'openai', modelId: activeModelId }],
              addedProviders: {},
              addedModels: [
                { providerId: 'openai', id: 'gpt-4o', name: modelName, enabled: true },
                { providerId: 'openai', id: 'model-to-remove', name: 'Old Model', enabled: true },
              ],
            },
          },
        };
        return { prefs, deviceAddon };
      };

      const activateDevice = (device: { prefs: Map<string, any>; deviceAddon: any }) => {
        (globalThis as any).Zotero = {
          Prefs: {
            get: (k: string) => device.prefs.get(k),
            set: (k: string, v: any) => device.prefs.set(k, v),
          },
        };
        (globalThis as any).addon = device.deviceAddon;
      };

      const conn = {
        webdavUrl: 'https://dav.jianguoyun.com/dav/',
        username: 'u',
        password: 'p',
        remoteFolder: 'zotero-ai-bar',
        includeApiKeys: true,
      };

      resetWebDavSyncStateForTests();
      const deviceA = createDeviceState('Prompt v1', 'sk-old', 'GPT-4o v1', 'gpt-4o');
      const deviceB = createDeviceState('Prompt v1', 'sk-old', 'GPT-4o v1', 'gpt-4o');

      // Initial sync on Device A and Device B
      activateDevice(deviceA);
      setPref('chat.fontSize' as any, 14 as any);
      setPref('translate.targetLanguage' as any, 'zh-CN' as any);
      await syncWithWebDav('sync', conn, mockFetch);

      activateDevice(deviceB);
      setPref('chat.fontSize' as any, 14 as any);
      setPref('translate.targetLanguage' as any, 'zh-CN' as any);
      await syncWithWebDav('sync', conn, mockFetch);

      // Modify settings, prompt, model, API key, active model, and delete a prompt + model on Device A
      activateDevice(deviceA);
      setPref('chat.fontSize' as any, 18 as any);
      setPref('translate.targetLanguage' as any, 'en-US' as any);
      deviceA.deviceAddon.data.userPrompts = [{ id: 'p-edit', name: 'Summary', content: 'Prompt v2 (edited on A)' }];
      deviceA.deviceAddon.data.userProviderConfigV2.active = { providerId: 'openai', modelId: 'gpt-4.1' };
      deviceA.deviceAddon.data.userProviderConfigV2.env.openai.OPENAI_API_KEY = 'sk-new-from-A';
      deviceA.deviceAddon.data.userProviderConfigV2.addedModels = [
        { providerId: 'openai', id: 'gpt-4o', name: 'GPT-4o v2 (edited on A)', enabled: false },
      ];
      await syncWithWebDav('sync', conn, mockFetch);

      // Device B has untouched local settings/prompts/models and runs bidirectional sync
      activateDevice(deviceB);
      await syncWithWebDav('sync', conn, mockFetch);

      assert.equal(getPref('chat.fontSize' as any), 18);
      assert.equal(getPref('translate.targetLanguage' as any), 'en-US');
      assert.deepEqual(deviceB.deviceAddon.data.userPrompts, [{ id: 'p-edit', name: 'Summary', content: 'Prompt v2 (edited on A)' }]);
      assert.deepEqual(deviceB.deviceAddon.data.userProviderConfigV2.active, {
        providerId: 'openai',
        modelId: 'gpt-4.1',
      });
      assert.equal(deviceB.deviceAddon.data.userProviderConfigV2.env.openai.OPENAI_API_KEY, 'sk-new-from-A');
      assert.deepEqual(deviceB.deviceAddon.data.userProviderConfigV2.addedModels, [
        { providerId: 'openai', id: 'gpt-4o', name: 'GPT-4o v2 (edited on A)', enabled: false },
      ]);

      // Also verify explicit 'pull' mode pulls cloud changes even if cloud payload has an older exportedAt
      const cloudParsed = JSON.parse(cloudFileText) as WebDavSyncPayload;
      cloudParsed.exportedAt = 100;
      cloudParsed.settings = { ...(cloudParsed.settings ?? {}), 'chat.fontSize': 22 };
      cloudFileText = JSON.stringify(cloudParsed);

      await syncWithWebDav('pull', conn, mockFetch);
      assert.equal(getPref('chat.fontSize' as any), 22);

      // Force push ('push') from Device A with fontSize=14 must not be reverted by Device B's next normal 'sync'
      activateDevice(deviceA);
      setPref('chat.fontSize' as any, 14 as any);
      await syncWithWebDav('push', conn, mockFetch);

      activateDevice(deviceB);
      await syncWithWebDav('sync', conn, mockFetch);
      assert.equal(getPref('chat.fontSize' as any), 14);
      const afterBSync = JSON.parse(cloudFileText) as WebDavSyncPayload;
      assert.equal(afterBSync.settings?.['chat.fontSize'], 14);

      // Cloud snapshot uploaded with includeApiKeys=false must not wipe another device's local API key
      activateDevice(deviceA);
      await syncWithWebDav('push', { ...conn, includeApiKeys: false }, mockFetch);
      const cloudWithoutKeys = JSON.parse(cloudFileText) as WebDavSyncPayload;
      assert.deepEqual(cloudWithoutKeys.providerConfigV2?.env, {});
      assert.deepEqual(cloudWithoutKeys.syncMeta?.envUpdatedAt ?? {}, {});

      const deviceC = createDeviceState('Prompt v1', 'sk-device-c-local-only', 'GPT-4o v1', 'gpt-4o');
      activateDevice(deviceC);
      await syncWithWebDav('sync', { ...conn, includeApiKeys: true }, mockFetch);
      assert.equal(deviceC.deviceAddon.data.userProviderConfigV2.env.openai.OPENAI_API_KEY, 'sk-device-c-local-only');
    } finally {
      resetWebDavSyncStateForTests();
      (globalThis as any).Zotero = prevZotero;
      (globalThis as any).addon = prevAddon;
    }
  });

  describe('WebDAV synchronization safety', function () {
    const connection = { webdavUrl: 'https://dav.example/', remoteFolder: 'test', username: 'u', password: 'p', includeApiKeys: false };
    let oldZotero: any;
    let oldAddon: any;

    beforeEach(function () {
      oldZotero = (globalThis as any).Zotero;
      oldAddon = (globalThis as any).addon;
      const prefs = new Map();
      (globalThis as any).Zotero = { Prefs: { get: (k: string) => prefs.get(k), set: (k: string, v: any) => prefs.set(k, v) } };
      (globalThis as any).addon = { data: { userPrompts: [{ id: 'p', name: 'P', content: 'original' }] } };
      resetWebDavSyncStateForTests();
    });

    afterEach(function () {
      (globalThis as any).Zotero = oldZotero;
      (globalThis as any).addon = oldAddon;
    });
    function payload(): WebDavSyncPayload {
      return { schema: WEBDAV_SYNC_SCHEMA, exportedAt: 1, chatHistory: { version: 2, activeByScope: {}, conversations: [] }, userPrompts: [] };
    }

    it('preserves prompt edits while GET and PUT are pending', async function () {
      let uploaded: any;
      const fetcher = async (_url: string, init: any) => {
        if (init.method === 'GET') {
          (globalThis as any).addon.data.userPrompts[0].content = 'edited during GET';
          return { status: 200, headers: { get: () => '"v1"' }, text: async () => JSON.stringify(payload()) };
        }
        if (init.method === 'PUT') {
          uploaded = JSON.parse(init.body);
          (globalThis as any).addon.data.userPrompts[0].content = 'edited during PUT';
        }
        return { status: 200, text: async () => '' };
      };
      await syncWithWebDav('sync', connection, fetcher as any);
      assert.equal(uploaded.userPrompts[0].content, 'edited during GET');
      assert.equal((globalThis as any).addon.data.userPrompts[0].content, 'edited during PUT');
    });

    it('re-reads and merges a concurrent writer after HTTP 412', async function () {
      let reads = 0;
      let writes = 0;
      const fetcher = async (_url: string, init: any) => {
        if (init.method === 'GET') {
          reads++;
          const remote = payload();
          if (reads > 1) remote.userPrompts = [{ id: 'other', name: 'Other', content: 'concurrent' }];
          return { status: 200, headers: { get: () => '"v' + reads + '"' }, text: async () => JSON.stringify(remote) };
        }
        if (init.method === 'PUT') {
          writes++;
          assert.equal(init.headers['If-Match'], '"v' + reads + '"');
          if (writes === 1) return { status: 412, text: async () => '' };
          assert.include(JSON.stringify(JSON.parse(init.body).userPrompts), 'concurrent');
        }
        return { status: 200, text: async () => '' };
      };
      await syncWithWebDav('sync', connection, fetcher as any);
      assert.equal(reads, 2);
      assert.equal(writes, 2);
    });

    it('refuses to overwrite an existing snapshot without a strong ETag', async function () {
      let writes = 0;
      try {
        await syncWithWebDav('sync', connection, (async (_url: string, init: any) => {
          if (init.method === 'PUT') writes++;
          return { status: 200, text: async () => JSON.stringify(payload()) };
        }) as any);
        assert.fail('Expected missing ETag to fail');
      } catch (error: any) {
        assert.include(error.message, 'strong ETag');
      }
      assert.equal(writes, 0);
    });

    it('protects initial snapshot creation with If-None-Match', async function () {
      await syncWithWebDav('sync', connection, (async (_url: string, init: any) => {
        if (init.method === 'GET') return { status: 404, text: async () => '' };
        if (init.method === 'PUT') assert.equal(init.headers['If-None-Match'], '*');
        return { status: 200, text: async () => '' };
      }) as any);
    });
  });

  describe('WebDAV credentials and portable identities', function () {
    it('migrates the legacy password only after successful credential storage', async function () {
      const g = globalThis as any;
      const old = { Zotero: g.Zotero, Services: g.Services, Components: g.Components };
      const prefs = new Map<string, any>();
      let stored: any;
      try {
        g.Zotero = {
          Prefs: { get: (k: string) => prefs.get(k), set: (k: string, v: any) => prefs.set(k, v), clear: (k: string) => prefs.delete(k) },
          OSKeyStore: { encrypt: async (v: string) => 'encrypted:' + v, decrypt: async (v: string) => v.slice(10) },
        };
        g.Components = {
          Constructor: function () {
            return function (this: any, _origin: string, _form: any, _realm: string, username: string, password: string) {
              this.username = username;
              this.password = password;
            };
          },
        };
        const manager = {
          searchLoginsAsync: async () => (stored ? [stored] : []),
          addLoginAsync: async (login: any) => {
            stored = login;
          },
        };
        g.Services = { logins: manager };
        setPref('sync.password', 'secret');
        const { getWebDavPassword } = await import('../src/modules/webdavCredentials');
        assert.equal(await getWebDavPassword(), 'secret');
        assert.equal(stored.password, 'encrypted:secret');
        assert.isUndefined(getPref('sync.password'));
        assert.equal(await getWebDavPassword(), 'secret');
        stored = undefined;
        setPref('sync.password', 'keep-on-error');
        manager.addLoginAsync = async () => {
          throw new Error('vault unavailable');
        };
        try {
          await getWebDavPassword();
          assert.fail('Expected save failure');
        } catch (error: any) {
          assert.include(error.message, 'vault unavailable');
        }
        assert.equal(getPref('sync.password'), 'keep-on-error');
      } finally {
        Object.assign(g, old);
      }
    });

    it('resolves a different item key by DOI and leaves duplicate matches unresolved', async function () {
      const item = (id: number) => ({ id, key: 'LOCAL' + id, libraryID: 1, getField: (k: string) => (k === 'DOI' ? '10.1000/example' : '') });
      let items = [item(20)];
      const Z = {
        Libraries: { userLibraryID: 1, getAll: () => [{ libraryID: 1 }] },
        Items: { getAll: async () => items, getByLibraryAndKey: () => false, get: () => undefined },
      };
      const conv = { ...conversation(1), itemKey: 'REMOTE', itemIdentity: { doi: '10.1000/example' } };
      await preparePortableItemIndex(Z);
      assert.equal(resolveLocalItemIdForConversation(conv, Z), 20);
      items = [item(20), item(21)];
      await preparePortableItemIndex(Z);
      assert.isBelow(resolveLocalItemIdForConversation(conv, Z)!, 0);
    });

    it('verifies write/read/delete and cleans up after a failed readback', async function () {
      const conn = { webdavUrl: 'https://dav.example/', username: 'u', password: 'p' };
      const methods: string[] = [];
      try {
        await testWebDavConnection(conn, (async (_url: string, init: any) => {
          methods.push(init.method);
          return { status: init.method === 'DELETE' ? 204 : 200, text: async () => 'wrong content' };
        }) as any);
        assert.fail('Expected readback failure');
      } catch (error: any) {
        assert.include(error.message, 'read back');
      }
      assert.deepEqual(methods, ['PROPFIND', 'PUT', 'GET', 'DELETE']);
      const readonlyMethods: string[] = [];
      try {
        await testWebDavConnection(conn, (async (_url: string, init: any) => {
          readonlyMethods.push(init.method);
          return { status: init.method === 'PUT' ? 403 : 200, text: async () => '' };
        }) as any);
        assert.fail('Expected read-only failure');
      } catch (error: any) {
        assert.include(error.message, '403');
      }
      assert.deepEqual(readonlyMethods, ['PROPFIND', 'PUT']);
    });
  });
});

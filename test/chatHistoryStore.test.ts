import { assert } from 'chai';
import {
  MAX_REGULAR_CONVERSATIONS,
  MAX_REGULAR_TURNS,
  makeConversationTitle,
  normalizeTextContext,
  pruneHistory,
  sanitizeHistoryFile,
  type PersistedChatHistoryFile,
  type PersistedConversation,
} from '../src/modules/chatHistoryStore';

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
});

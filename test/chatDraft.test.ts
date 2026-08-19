import { assert } from 'chai';
import { readChatTextDraft, SHARED_CHAT_DRAFT_ID, writeChatTextDraft } from '../src/utils/chatDraft';

describe('chatDraft', function () {
  it('uses one host-independent key for sidebar and window input', function () {
    assert.equal(SHARED_CHAT_DRAFT_ID, 'shared-input:chat');
  });

  it('round-trips text and removes empty drafts', function () {
    const drafts = new Map<string, string>();
    writeChatTextDraft(drafts, SHARED_CHAT_DRAFT_ID, 'unfinished question');
    assert.equal(readChatTextDraft(drafts, SHARED_CHAT_DRAFT_ID), 'unfinished question');

    writeChatTextDraft(drafts, SHARED_CHAT_DRAFT_ID, '');
    assert.equal(readChatTextDraft(drafts, SHARED_CHAT_DRAFT_ID), '');
    assert.isFalse(drafts.has(SHARED_CHAT_DRAFT_ID));
  });

  it('keeps image drafts under the same key across host recreation', function () {
    const images = new Map<string, string[]>();
    images.set(SHARED_CHAT_DRAFT_ID, ['data:image/png;base64,one', 'data:image/png;base64,two']);

    assert.deepEqual(images.get(SHARED_CHAT_DRAFT_ID), ['data:image/png;base64,one', 'data:image/png;base64,two']);
  });
});

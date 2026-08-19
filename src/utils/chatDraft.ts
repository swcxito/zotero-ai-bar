export const SHARED_CHAT_DRAFT_ID = 'shared-input:chat';

export function readChatTextDraft(drafts: Map<string, string>, draftId: string): string {
  return drafts.get(draftId) ?? '';
}

export function writeChatTextDraft(drafts: Map<string, string>, draftId: string, value: string): void {
  if (value) {
    drafts.set(draftId, value);
  } else {
    drafts.delete(draftId);
  }
}

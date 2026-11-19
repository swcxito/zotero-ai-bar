import type { ModelMessage, UserModelMessage } from 'ai';
import { getItem } from './attachments';

export interface GlobalReaderContext {
  tabId: string;
  attachmentId: number;
}

export function snapshotGlobalReaderContext(): GlobalReaderContext | null {
  const tabId = Zotero.getMainWindow()?.Zotero_Tabs?.selectedID;
  const reader = tabId ? Zotero.Reader.getByTabID(tabId) : undefined;
  const attachment = reader?.itemID ? getItem(reader.itemID) : undefined;
  return tabId && attachment?.attachmentContentType === 'application/pdf' ? { tabId, attachmentId: attachment.id } : null;
}

const contextPattern = /^(<zotero-reader-context(?: tab="[^"]+" itemId="\d+")?>)[^\n]*<\/zotero-reader-context>\n\n/;

function readerContextInMessage(message: ModelMessage) {
  if (message.role !== 'user') return undefined;
  const { content } = message;
  const text = typeof content === 'string' ? content : content[0]?.type === 'text' ? content[0].text : undefined;
  return text?.match(contextPattern);
}

function lastReaderContext(history: readonly ModelMessage[]) {
  for (let index = history.length - 1; index >= 0; index--) {
    const context = readerContextInMessage(history[index]);
    if (context) return context;
  }
}

export function globalReaderContextPrefix(current: GlobalReaderContext | null, history: readonly ModelMessage[]): string {
  const previousTag = lastReaderContext(history)?.[1];
  const tag = current
    ? `<zotero-reader-context tab="${encodeURIComponent(current.tabId)}" itemId="${current.attachmentId}">`
    : '<zotero-reader-context>';
  if (tag === previousTag || (!current && !previousTag)) return '';
  const notice = current
    ? `${previousTag ? 'User switched to' : 'Current Zotero reader is on'} the PDF attachment with itemId ${current.attachmentId}.`
    : 'User left the PDF reader. No current PDF attachment is available.';
  return `${tag}${notice}</zotero-reader-context>\n\n`;
}

/** Retain the active reader context when its original turn is summarized. */
export function carryGlobalReaderContext(head: readonly ModelMessage[], tail: ModelMessage[]): ModelMessage[] {
  const context = lastReaderContext(head)?.[0];
  if (!context) return tail;
  const firstUserIndex = tail.findIndex((message) => message.role === 'user');
  const firstUser = tail[firstUserIndex] as UserModelMessage | undefined;
  if (!firstUser || readerContextInMessage(firstUser)) return tail;
  const content: UserModelMessage['content'] =
    typeof firstUser.content === 'string' ? context + firstUser.content : [{ type: 'text', text: context }, ...firstUser.content];
  const updated = [...tail];
  updated[firstUserIndex] = { ...firstUser, content };
  return updated;
}

import type { ModelMessage } from 'ai';

export type ConversationScope = `article:${number}` | 'global-agent';

export interface PersistedTurn {
  id: string;
  createdAt: number;
  userText?: string;
  referenceText?: string;
  assistantMarkdown: string;
  sourceLabel?: string;
}

export interface PersistedTextMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PersistedConversation {
  id: string;
  scope: ConversationScope;
  kind: 'article' | 'global-agent';
  itemId?: number;
  title: string;
  favorite: boolean;
  createdAt: number;
  lastMessageAt: number;
  turns: PersistedTurn[];
  contextMessages: PersistedTextMessage[];
}

export interface PersistedChatHistoryFile {
  version: 1;
  activeByScope: Record<string, string>;
  conversations: PersistedConversation[];
}

const HISTORY_VERSION = 1 as const;
export const MAX_REGULAR_CONVERSATIONS = 100;
export const MAX_REGULAR_TURNS = 100;
const HISTORY_FILENAME = 'chat-history-v1.json';

function emptyHistoryFile(): PersistedChatHistoryFile {
  return { version: HISTORY_VERSION, activeByScope: {}, conversations: [] };
}

export function getConversationScope(kind: 'article' | 'global-agent', itemId?: number): ConversationScope | undefined {
  if (kind === 'global-agent') return 'global-agent';
  return itemId === undefined ? undefined : `article:${itemId}`;
}

function isTextMessage(value: any): value is PersistedTextMessage {
  return !!value && (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string' && value.content.trim().length > 0;
}

function isTurn(value: any): value is PersistedTurn {
  return (
    !!value &&
    typeof value.id === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.assistantMarkdown === 'string' &&
    (value.userText === undefined || typeof value.userText === 'string') &&
    (value.referenceText === undefined || typeof value.referenceText === 'string') &&
    (value.sourceLabel === undefined || typeof value.sourceLabel === 'string')
  );
}

function sanitizeConversation(value: any): PersistedConversation | undefined {
  if (!value || typeof value.id !== 'string' || typeof value.scope !== 'string') return undefined;
  if (value.kind !== 'article' && value.kind !== 'global-agent') return undefined;
  if (value.kind === 'article' && typeof value.itemId !== 'number') return undefined;
  const expectedScope = getConversationScope(value.kind, value.itemId);
  if (!expectedScope || value.scope !== expectedScope) return undefined;
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now();
  const lastMessageAt = typeof value.lastMessageAt === 'number' ? value.lastMessageAt : createdAt;
  const favorite = value.favorite === true;
  const turns = Array.isArray(value.turns) ? value.turns.filter(isTurn) : [];
  return {
    id: value.id,
    scope: expectedScope,
    kind: value.kind,
    itemId: value.kind === 'article' ? value.itemId : undefined,
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '',
    favorite,
    createdAt,
    lastMessageAt,
    turns: favorite ? turns : turns.slice(-MAX_REGULAR_TURNS),
    contextMessages: Array.isArray(value.contextMessages) ? value.contextMessages.filter(isTextMessage) : [],
  };
}

export function sanitizeHistoryFile(value: any): PersistedChatHistoryFile | null | 'unsupported' {
  if (!value || typeof value !== 'object') return null;
  if (value.version !== HISTORY_VERSION) return typeof value.version === 'number' && value.version > HISTORY_VERSION ? 'unsupported' : null;
  const conversations: PersistedConversation[] = Array.isArray(value.conversations)
    ? value.conversations
        .map((entry: any) => sanitizeConversation(entry))
        .filter((entry: PersistedConversation | undefined): entry is PersistedConversation => !!entry)
    : [];
  const ids = new Set(conversations.map((entry) => entry.id));
  const activeByScope: Record<string, string> = {};
  if (value.activeByScope && typeof value.activeByScope === 'object') {
    for (const [scope, id] of Object.entries(value.activeByScope)) {
      if (typeof id === 'string' && ids.has(id) && conversations.some((entry) => entry.id === id && entry.scope === scope)) {
        activeByScope[scope] = id;
      }
    }
  }
  return pruneHistory({ version: HISTORY_VERSION, activeByScope, conversations });
}

export function pruneHistory(file: PersistedChatHistoryFile): PersistedChatHistoryFile {
  for (const conversation of file.conversations) {
    if (!conversation.favorite && conversation.turns.length > MAX_REGULAR_TURNS) {
      conversation.turns = conversation.turns.slice(-MAX_REGULAR_TURNS);
    }
  }
  const regular = file.conversations.filter((entry) => !entry.favorite).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  const evicted = new Set(regular.slice(MAX_REGULAR_CONVERSATIONS).map((entry) => entry.id));
  if (evicted.size) file.conversations = file.conversations.filter((entry) => !evicted.has(entry.id));
  for (const [scope, id] of Object.entries(file.activeByScope)) {
    if (!file.conversations.some((entry) => entry.id === id && entry.scope === scope)) delete file.activeByScope[scope];
  }
  return file;
}

function contentToText(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

export function normalizeTextContext(messages: ModelMessage[], maxRounds: number): PersistedTextMessage[] {
  const textMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role as 'user' | 'assistant', content: contentToText((message as any).content) }))
    .filter(isTextMessage);
  const starts: number[] = [];
  for (let index = 0; index < textMessages.length; index++) {
    if (textMessages[index].role === 'user') starts.push(index);
  }
  if (!starts.length || starts.length <= maxRounds) return textMessages;
  return textMessages.slice(starts[starts.length - maxRounds]);
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[`*_>#~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function makeConversationTitle(userText: string | undefined, assistantMarkdown: string, fallback: string): string {
  const text = plainText(userText || '') || plainText(assistantMarkdown) || fallback;
  return text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text;
}

export class ChatHistoryStore {
  private data: PersistedChatHistoryFile = emptyHistoryFile();
  private writeQueue: Promise<void> = Promise.resolve();
  private readOnly = false;

  private get directoryPath(): string {
    return PathUtils.join(PathUtils.profileDir, addon.data.config.addonRef);
  }

  private get filePath(): string {
    return PathUtils.join(this.directoryPath, HISTORY_FILENAME);
  }

  async initialize(): Promise<void> {
    this.data = emptyHistoryFile();
    if (!(await IOUtils.exists(this.filePath))) return;
    const primary = await this.readFile(this.filePath);
    if (primary === 'unsupported') {
      this.readOnly = true;
      ztoolkit.log('[chatHistory] newer history version detected; persistence disabled to preserve the file');
      return;
    }
    if (primary) {
      this.data = primary;
      return;
    }
    const backup = await this.readFile(`${this.filePath}.bak`);
    if (backup === 'unsupported') {
      this.readOnly = true;
      return;
    }
    if (backup) this.data = backup;
  }

  private async readFile(path: string): Promise<PersistedChatHistoryFile | null | 'unsupported'> {
    try {
      if (!(await IOUtils.exists(path))) return null;
      return sanitizeHistoryFile(await IOUtils.readJSON(path));
    } catch (error) {
      ztoolkit.log('[chatHistory] failed to read history file:', path, error);
      return null;
    }
  }

  list(scope: ConversationScope): PersistedConversation[] {
    return this.data.conversations.filter((entry) => entry.scope === scope).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  get(id: string): PersistedConversation | undefined {
    return this.data.conversations.find((entry) => entry.id === id);
  }

  getActive(scope: ConversationScope): PersistedConversation | undefined {
    const activeId = this.data.activeByScope[scope];
    return (activeId ? this.get(activeId) : undefined) ?? this.list(scope)[0];
  }

  setActive(scope: ConversationScope, id: string): void {
    if (!this.get(id)) return;
    this.data.activeByScope[scope] = id;
    this.scheduleWrite();
  }

  upsert(conversation: PersistedConversation): void {
    const index = this.data.conversations.findIndex((entry) => entry.id === conversation.id);
    const normalized = sanitizeConversation(conversation);
    if (!normalized) return;
    if (index >= 0) this.data.conversations[index] = normalized;
    else this.data.conversations.push(normalized);
    this.data.activeByScope[normalized.scope] = normalized.id;
    pruneHistory(this.data);
    this.scheduleWrite();
  }

  rename(id: string, title: string): void {
    const conversation = this.get(id);
    if (!conversation || !title.trim()) return;
    conversation.title = title.trim();
    this.scheduleWrite();
  }

  setFavorite(id: string, favorite: boolean): void {
    const conversation = this.get(id);
    if (!conversation) return;
    conversation.favorite = favorite;
    pruneHistory(this.data);
    this.scheduleWrite();
  }

  delete(id: string): void {
    this.data.conversations = this.data.conversations.filter((entry) => entry.id !== id);
    for (const [scope, activeId] of Object.entries(this.data.activeByScope)) {
      if (activeId === id) delete this.data.activeByScope[scope];
    }
    this.scheduleWrite();
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private scheduleWrite(): void {
    if (this.readOnly) return;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await IOUtils.makeDirectory(this.directoryPath, { ignoreExisting: true });
        await IOUtils.writeJSON(this.filePath, this.data, {
          tmpPath: `${this.filePath}.tmp`,
          backupFile: `${this.filePath}.bak`,
          flush: true,
        });
      })
      .catch((error) => ztoolkit.log('[chatHistory] failed to persist history:', error));
  }
}

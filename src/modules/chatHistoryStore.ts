import type { ModelMessage } from 'ai';
import { createCheckpointMessage, type ContextCheckpoint } from './contextCompaction';
import { sanitizeCodexBinding, type CodexBinding } from './codex/policy';

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
  itemKey?: string;
  itemIdentity?: PortableItemIdentity;
  libraryType?: 'user' | 'group';
  groupId?: number;
  title: string;
  favorite: boolean;
  createdAt: number;
  lastMessageAt: number;
  updatedAt?: number;
  turns: PersistedTurn[];
  contextMessages: ModelMessage[];
  checkpoint?: ContextCheckpoint;
  codex?: CodexBinding;
}

export interface PersistedChatHistoryFile {
  version: 2;
  activeByScope: Record<string, string>;
  conversations: PersistedConversation[];
  deletedConversations?: Record<string, number>;
}

const HISTORY_VERSION = 2 as const;
export const MAX_REGULAR_CONVERSATIONS = 100;
export const MAX_REGULAR_TURNS = 100;
export const MAX_DELETED_TOMBSTONES = 500;
const HISTORY_FILENAME = 'chat-history-v1.json';

function emptyHistoryFile(): PersistedChatHistoryFile {
  return { version: HISTORY_VERSION, activeByScope: {}, conversations: [], deletedConversations: {} };
}

export function getConversationScope(kind: 'article' | 'global-agent', itemId?: number): ConversationScope | undefined {
  if (kind === 'global-agent') return 'global-agent';
  return itemId === undefined ? undefined : `article:${itemId}`;
}

export interface PortableItemIdentity {
  doi?: string;
  isbn?: string;
  title?: string;
  author?: string;
  year?: string;
}

function itemIdentity(item: any): PortableItemIdentity {
  const normalize = (v: string) =>
    v
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  const field = (name: string) => String(item.getField?.(name) || '').trim();
  return {
    doi: field('DOI')
      .replace(/^https?:\/\/(?:dx\.)?doi.org\//i, '')
      .toLowerCase(),
    isbn: field('ISBN')
      .replace(/[^0-9X]/gi, '')
      .toUpperCase(),
    title: normalize(field('title')),
    author: normalize(String(item.getCreators?.()[0]?.lastName || '')),
    year: field('date').match(/\b\d{4}\b/)?.[0] || '',
  };
}

function identityKey(identity: PortableItemIdentity, kind: 'doi' | 'isbn' | 'title'): string | undefined {
  if (kind !== 'title') return identity[kind] || undefined;
  return identity.title && identity.author && identity.year ? JSON.stringify([identity.title, identity.author, identity.year]) : undefined;
}

let portableIndex = new Map<number, Map<string, number[]>>();

export async function preparePortableItemIndex(zoteroGlobal?: any): Promise<void> {
  const Z = zoteroGlobal ?? (typeof Zotero !== 'undefined' ? Zotero : undefined);
  portableIndex = new Map();
  if (!Z?.Items?.getAll || !Z.Libraries?.getAll) return;
  for (const lib of Z.Libraries.getAll()) {
    const index = new Map<string, number[]>();
    const items = await Z.Items.getAll(lib.libraryID, true, false);
    await Z.Items.loadDataTypes?.(items, ['itemData', 'creators']);
    for (const item of items) {
      if (item.isRegularItem && !item.isRegularItem()) continue;
      const identity = itemIdentity(item);
      for (const kind of ['doi', 'isbn', 'title'] as const) {
        const key = identityKey(identity, kind);
        if (key) index.set(kind + ':' + key, [...(index.get(kind + ':' + key) || []), item.id]);
      }
    }
    portableIndex.set(lib.libraryID, index);
  }
}

export function unresolvedItemId(itemKey: string, groupId?: number): number {
  const seed = groupId !== undefined ? `group:${groupId}:${itemKey.trim()}` : `user:${itemKey.trim()}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  const positive = (hash >>> 0) % 2147483646;
  return -(positive + 1);
}

export function attachPortableItemMetadata(conversation: PersistedConversation, zoteroGlobal?: any): PersistedConversation {
  if (conversation.kind !== 'article' || typeof conversation.itemId !== 'number' || conversation.itemId <= 0) {
    return conversation;
  }
  const Z = zoteroGlobal ?? (typeof Zotero !== 'undefined' ? Zotero : undefined);
  if (!Z?.Items?.get) return conversation;
  try {
    const item = Z.Items.get(conversation.itemId);
    if (!item || typeof item.key !== 'string' || !item.key.trim()) return conversation;
    conversation.itemKey = item.key.trim();
    conversation.itemIdentity = itemIdentity(item);
    const lib = typeof item.libraryID === 'number' ? Z.Libraries?.get?.(item.libraryID) : undefined;
    if (lib?.libraryType === 'group' && typeof lib.groupID === 'number') {
      conversation.libraryType = 'group';
      conversation.groupId = lib.groupID;
    } else {
      conversation.libraryType = 'user';
      delete conversation.groupId;
    }
  } catch (_error) {
    // Ignore Zotero lookup errors in non-Zotero test environments.
  }
  return conversation;
}

export function resolveLocalItemIdForConversation(
  conversation: Pick<PersistedConversation, 'kind' | 'itemId' | 'itemKey' | 'libraryType' | 'groupId' | 'itemIdentity'>,
  zoteroGlobal?: any
): number | undefined {
  if (conversation.kind !== 'article') return undefined;
  const Z = zoteroGlobal ?? (typeof Zotero !== 'undefined' ? Zotero : undefined);
  if (!Z?.Items) return conversation.itemId;
  const itemKey = typeof conversation.itemKey === 'string' ? conversation.itemKey.trim() : '';
  if (!itemKey) return conversation.itemId;
  try {
    let libraryID: number | undefined;
    if (conversation.libraryType === 'group') {
      const group = typeof conversation.groupId === 'number' ? Z.Groups?.get?.(conversation.groupId) : undefined;
      libraryID = typeof group?.libraryID === 'number' ? group.libraryID : undefined;
    } else {
      libraryID = typeof Z.Libraries?.userLibraryID === 'number' ? Z.Libraries.userLibraryID : undefined;
    }
    if (typeof libraryID === 'number' && typeof Z.Items.getByLibraryAndKey === 'function') {
      const matched = Z.Items.getByLibraryAndKey(libraryID, itemKey);
      if (matched && typeof matched.id === 'number') return matched.id;
    }
    if (typeof conversation.itemId === 'number' && conversation.itemId > 0 && typeof Z.Items.get === 'function') {
      const existing = Z.Items.get(conversation.itemId);
      if (existing && existing.key === itemKey && existing.libraryID === libraryID) return conversation.itemId;
    }
    if (typeof libraryID === 'number' && conversation.itemIdentity) {
      for (const kind of ['doi', 'isbn', 'title'] as const) {
        const key = identityKey(conversation.itemIdentity, kind);
        const candidates = key ? portableIndex.get(libraryID)?.get(kind + ':' + key) : undefined;
        if (candidates?.length === 1) return candidates[0];
        if (candidates?.length) break; // Ambiguous identities must not be bound automatically.
      }
    }
    return unresolvedItemId(itemKey, conversation.libraryType === 'group' ? conversation.groupId : undefined);
  } catch (_error) {
    return unresolvedItemId(itemKey, conversation.libraryType === 'group' ? conversation.groupId : undefined);
  }
}

export function rebindPortableHistoryFile(file: PersistedChatHistoryFile, zoteroGlobal?: any): boolean {
  let changed = false;
  for (const conversation of file.conversations) {
    if (conversation.kind !== 'article') continue;
    const beforeIdentity = JSON.stringify(conversation.itemIdentity);
    const beforeKey = conversation.itemKey;
    const beforeLib = conversation.libraryType;
    const beforeGroup = conversation.groupId;
    if (!conversation.itemKey && typeof conversation.itemId === 'number' && conversation.itemId > 0) {
      attachPortableItemMetadata(conversation, zoteroGlobal);
      if (conversation.itemKey !== beforeKey || conversation.libraryType !== beforeLib || conversation.groupId !== beforeGroup) {
        changed = true;
      }
      continue;
    }
    if (conversation.itemKey) {
      const resolvedId = resolveLocalItemIdForConversation(conversation, zoteroGlobal);
      if (resolvedId === conversation.itemId && resolvedId && resolvedId > 0) {
        attachPortableItemMetadata(conversation, zoteroGlobal);
        if (JSON.stringify(conversation.itemIdentity) !== beforeIdentity) changed = true;
      }
      if (typeof resolvedId === 'number' && resolvedId !== conversation.itemId) {
        const oldScope = conversation.scope;
        const newScope = getConversationScope('article', resolvedId)!;
        conversation.itemId = resolvedId;
        conversation.scope = newScope;
        attachPortableItemMetadata(conversation, zoteroGlobal);
        if (file.activeByScope[oldScope] === conversation.id) {
          delete file.activeByScope[oldScope];
          file.activeByScope[newScope] ??= conversation.id;
        }
        changed = true;
      }
    }
  }
  return changed;
}

function isTextMessage(value: any): value is PersistedTextMessage {
  return !!value && (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string' && value.content.trim().length > 0;
}

function isModelMessage(value: any): value is ModelMessage {
  return (
    !!value &&
    (value.role === 'user' || value.role === 'assistant' || value.role === 'tool') &&
    (typeof value.content === 'string' || Array.isArray(value.content))
  );
}

function sanitizeCheckpoint(value: any): ContextCheckpoint | undefined {
  if (!value || typeof value.summary !== 'string' || !value.summary.trim() || typeof value.createdAt !== 'number') return undefined;
  return {
    summary: value.summary,
    coveredThroughTurnId: typeof value.coveredThroughTurnId === 'string' ? value.coveredThroughTurnId : undefined,
    createdAt: value.createdAt,
    recentTail: Array.isArray(value.recentTail) ? value.recentTail.filter(isModelMessage) : [],
  };
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
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? Math.max(value.updatedAt, lastMessageAt) : undefined;
  const favorite = value.favorite === true;
  const turns = Array.isArray(value.turns) ? value.turns.filter(isTurn) : [];
  const itemKey = value.kind === 'article' && typeof value.itemKey === 'string' && value.itemKey.trim() ? value.itemKey.trim() : undefined;
  const libraryType = value.kind === 'article' && (value.libraryType === 'user' || value.libraryType === 'group') ? value.libraryType : undefined;
  const groupId = value.kind === 'article' && libraryType === 'group' && typeof value.groupId === 'number' ? value.groupId : undefined;
  return {
    id: value.id,
    scope: expectedScope,
    kind: value.kind,
    itemId: value.kind === 'article' ? value.itemId : undefined,
    ...(itemKey ? { itemKey } : {}),
    ...(value.itemIdentity && typeof value.itemIdentity === 'object' ? { itemIdentity: value.itemIdentity } : {}),
    ...(libraryType ? { libraryType } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '',
    favorite,
    createdAt,
    lastMessageAt,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    turns: favorite ? turns : turns.slice(-MAX_REGULAR_TURNS),
    contextMessages: Array.isArray(value.contextMessages) ? value.contextMessages.filter(isModelMessage) : [],
    checkpoint: sanitizeCheckpoint(value.checkpoint),
    codex: sanitizeCodexBinding(value.codex),
  };
}

export function getConversationUpdatedAt(conversation: Pick<PersistedConversation, 'lastMessageAt' | 'updatedAt'>): number {
  return typeof conversation.updatedAt === 'number' && Number.isFinite(conversation.updatedAt)
    ? Math.max(conversation.updatedAt, conversation.lastMessageAt)
    : conversation.lastMessageAt;
}

export function turnsToContextMessages(turns: PersistedTurn[], checkpoint?: ContextCheckpoint): ModelMessage[] {
  let startIndex = 0;
  if (checkpoint?.coveredThroughTurnId) {
    const idx = turns.findIndex((t) => t.id === checkpoint.coveredThroughTurnId);
    if (idx >= 0) startIndex = idx + 1;
  }
  const messages: ModelMessage[] = [];
  for (const turn of turns.slice(startIndex)) {
    const userContent = turn.userText?.trim() || turn.referenceText?.trim();
    if (userContent) {
      messages.push({ role: 'user', content: userContent });
    }
    if (turn.assistantMarkdown.trim()) {
      messages.push({ role: 'assistant', content: turn.assistantMarkdown });
    }
  }
  return messages;
}

function sanitizeDeletedConversations(value: any): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value)
    .filter(([id, ts]) => typeof id === 'string' && id.trim() && typeof ts === 'number' && Number.isFinite(ts))
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, MAX_DELETED_TOMBSTONES);
  return Object.fromEntries(entries) as Record<string, number>;
}

export function sanitizeHistoryFile(value: any): PersistedChatHistoryFile | null | 'unsupported' {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.version === 'number' && value.version > HISTORY_VERSION) return 'unsupported';
  if (value.version !== 1 && value.version !== HISTORY_VERSION) return null;
  const deletedConversations = sanitizeDeletedConversations(value.deletedConversations);
  const conversations: PersistedConversation[] = Array.isArray(value.conversations)
    ? value.conversations
        .map((entry: any) => sanitizeConversation(entry))
        .filter((entry: PersistedConversation | undefined): entry is PersistedConversation => !!entry)
        .filter((entry: PersistedConversation) => {
          const deletedAt = deletedConversations[entry.id];
          return deletedAt === undefined || getConversationUpdatedAt(entry) > deletedAt;
        })
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
  return pruneHistory({ version: HISTORY_VERSION, activeByScope, conversations, deletedConversations });
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
  if (file.deletedConversations) {
    file.deletedConversations = sanitizeDeletedConversations(file.deletedConversations);
  }
  return file;
}

export interface MergeHistoryResult {
  merged: PersistedChatHistoryFile;
  imported: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

export function mergeHistoryFiles(localRaw: PersistedChatHistoryFile, remoteRaw: PersistedChatHistoryFile, zoteroGlobal?: any): MergeHistoryResult {
  const local = sanitizeHistoryFile(JSON.parse(JSON.stringify(localRaw))) || emptyHistoryFile();
  const remote = sanitizeHistoryFile(JSON.parse(JSON.stringify(remoteRaw))) || emptyHistoryFile();
  if (local === 'unsupported' || remote === 'unsupported') {
    throw new Error('Unsupported chat history version');
  }
  rebindPortableHistoryFile(local, zoteroGlobal);
  rebindPortableHistoryFile(remote, zoteroGlobal);

  const deletedConversations = sanitizeDeletedConversations({
    ...(local.deletedConversations ?? {}),
    ...Object.fromEntries(
      Object.entries(remote.deletedConversations ?? {}).map(([id, ts]) => [id, Math.max(ts, local.deletedConversations?.[id] ?? 0)])
    ),
  });

  let imported = 0;
  let updated = 0;
  let deleted = 0;
  let unchanged = 0;

  const byId = new Map<string, PersistedConversation>();
  for (const conv of local.conversations) {
    const deletedAt = deletedConversations[conv.id];
    if (deletedAt !== undefined && deletedAt >= getConversationUpdatedAt(conv)) {
      deleted++;
      continue;
    }
    byId.set(conv.id, conv);
  }

  for (const remoteConv of remote.conversations) {
    const deletedAt = deletedConversations[remoteConv.id];
    if (deletedAt !== undefined && deletedAt >= getConversationUpdatedAt(remoteConv)) {
      continue;
    }
    const existing = byId.get(remoteConv.id);
    if (!existing) {
      byId.set(remoteConv.id, remoteConv);
      imported++;
      continue;
    }
    const beforeJson = JSON.stringify(existing);
    const localUpdatedAt = getConversationUpdatedAt(existing);
    const remoteUpdatedAt = getConversationUpdatedAt(remoteConv);
    const newer = remoteUpdatedAt > localUpdatedAt ? remoteConv : existing;
    const older = newer === remoteConv ? existing : remoteConv;
    const newerTurnSide = remoteConv.lastMessageAt > existing.lastMessageAt ? remoteConv : existing;
    const olderTurnSide = newerTurnSide === remoteConv ? existing : remoteConv;

    const turnMap = new Map<string, PersistedTurn>();
    for (const t of olderTurnSide.turns) turnMap.set(t.id, t);
    for (const t of newerTurnSide.turns) turnMap.set(t.id, t);
    const mergedTurns = Array.from(turnMap.values()).sort((a, b) => a.createdAt - b.createdAt);

    const itemKey = newer.itemKey ?? older.itemKey;
    const libraryType = newer.libraryType ?? older.libraryType;
    const groupId = newer.groupId ?? older.groupId;
    const resolvedItemId =
      newer.kind === 'article'
        ? (resolveLocalItemIdForConversation(
            { kind: 'article', itemId: newer.itemId, itemKey, libraryType, groupId, itemIdentity: newer.itemIdentity ?? older.itemIdentity },
            zoteroGlobal
          ) ?? newer.itemId)
        : undefined;
    const resolvedScope = getConversationScope(newer.kind, resolvedItemId) ?? newer.scope;
    const mergedLastMessageAt = Math.max(existing.lastMessageAt, remoteConv.lastMessageAt);
    const mergedUpdatedAt = Math.max(localUpdatedAt, remoteUpdatedAt, mergedLastMessageAt);
    const finalTurns = newer.favorite ? mergedTurns : mergedTurns.slice(-MAX_REGULAR_TURNS);
    const mergedCheckpoint = newerTurnSide.checkpoint ?? olderTurnSide.checkpoint;
    const newerCoversAllTurns = newerTurnSide.turns.length === finalTurns.length && finalTurns.every((t, i) => t.id === newerTurnSide.turns[i]?.id);
    const synthesizedTail = turnsToContextMessages(finalTurns, mergedCheckpoint);
    const synthesizedContext: ModelMessage[] = mergedCheckpoint
      ? [createCheckpointMessage(mergedCheckpoint.summary), ...synthesizedTail]
      : synthesizedTail;
    const mergedContextMessages =
      newerCoversAllTurns && newerTurnSide.contextMessages.length >= synthesizedContext.length
        ? newerTurnSide.contextMessages
        : synthesizedContext.length
          ? synthesizedContext
          : newerTurnSide.contextMessages.length
            ? newerTurnSide.contextMessages
            : olderTurnSide.contextMessages;

    const mergedConv: PersistedConversation = {
      ...newer,
      contextMessages: mergedContextMessages,
      checkpoint: mergedCheckpoint
        ? {
            ...mergedCheckpoint,
            recentTail:
              newerCoversAllTurns && mergedCheckpoint.recentTail.length >= synthesizedTail.length ? mergedCheckpoint.recentTail : synthesizedTail,
          }
        : undefined,
      codex: newerTurnSide.codex ?? olderTurnSide.codex,
      scope: resolvedScope,
      itemId: resolvedItemId,
      ...(itemKey ? { itemKey } : {}),
      ...(libraryType ? { libraryType } : {}),
      ...(groupId !== undefined ? { groupId } : {}),
      createdAt: Math.min(existing.createdAt, remoteConv.createdAt),
      lastMessageAt: mergedLastMessageAt,
      ...(mergedUpdatedAt > mergedLastMessageAt || existing.updatedAt !== undefined || remoteConv.updatedAt !== undefined
        ? { updatedAt: mergedUpdatedAt }
        : {}),
      turns: finalTurns,
    };
    byId.set(remoteConv.id, mergedConv);
    if (JSON.stringify(mergedConv) !== beforeJson) {
      updated++;
    } else {
      unchanged++;
    }
  }

  const activeByScope: Record<string, string> = { ...remote.activeByScope, ...local.activeByScope };
  const merged = pruneHistory({
    version: HISTORY_VERSION,
    activeByScope,
    conversations: Array.from(byId.values()),
    deletedConversations,
  });

  return { merged, imported, updated, deleted, unchanged };
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
      if (rebindPortableHistoryFile(this.data)) this.scheduleWrite();
      return;
    }
    const backup = await this.readFile(`${this.filePath}.bak`);
    if (backup === 'unsupported') {
      this.readOnly = true;
      return;
    }
    if (backup) {
      this.data = backup;
      if (rebindPortableHistoryFile(this.data)) this.scheduleWrite();
    }
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
    if (rebindPortableHistoryFile(this.data)) this.scheduleWrite();
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
    const prevUpdatedAt = index >= 0 ? getConversationUpdatedAt(this.data.conversations[index]) : 0;
    normalized.updatedAt = Math.max(getConversationUpdatedAt(normalized), prevUpdatedAt);
    attachPortableItemMetadata(normalized);
    if (this.data.deletedConversations && normalized.id in this.data.deletedConversations) {
      delete this.data.deletedConversations[normalized.id];
    }
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
    conversation.updatedAt = Math.max(Date.now(), getConversationUpdatedAt(conversation) + 1);
    this.scheduleWrite();
  }

  setFavorite(id: string, favorite: boolean): void {
    const conversation = this.get(id);
    if (!conversation) return;
    conversation.favorite = favorite;
    conversation.updatedAt = Math.max(Date.now(), getConversationUpdatedAt(conversation) + 1);
    pruneHistory(this.data);
    this.scheduleWrite();
  }

  delete(id: string): void {
    const existing = this.get(id);
    const minTombstone = existing ? getConversationUpdatedAt(existing) : 0;
    this.data.conversations = this.data.conversations.filter((entry) => entry.id !== id);
    for (const [scope, activeId] of Object.entries(this.data.activeByScope)) {
      if (activeId === id) delete this.data.activeByScope[scope];
    }
    this.data.deletedConversations = {
      ...(this.data.deletedConversations ?? {}),
      [id]: Math.max(Date.now(), minTombstone),
    };
    pruneHistory(this.data);
    this.scheduleWrite();
  }

  getSnapshot(): PersistedChatHistoryFile {
    if (rebindPortableHistoryFile(this.data)) this.scheduleWrite();
    return JSON.parse(JSON.stringify(this.data)) as PersistedChatHistoryFile;
  }

  mergeRemote(remoteFile: PersistedChatHistoryFile): MergeHistoryResult {
    const result = mergeHistoryFiles(this.data, remoteFile);
    this.data = result.merged;
    this.scheduleWrite();
    return result;
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

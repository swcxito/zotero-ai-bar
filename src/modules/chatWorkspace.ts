export type ChatSessionKind = 'article' | 'translation' | 'global-agent';
export type ChatWorkspaceHost = 'sidebar' | 'window';

export const GLOBAL_AGENT_SESSION_ID = 'global-agent';

const activeKindBySource = new Map<string, ChatSessionKind>();
const visibleTranslationSources = new Set<string>();
const listeners = new Set<() => void>();

let selectedZoteroTabId: string | undefined;
let selectedReaderTabId: string | undefined;
let lastReaderTabId: string | undefined;

/**
 * Reader instances can be registered slightly after Zotero selects their
 * tab. Prefer the tab model's stable type and use the Reader registry only
 * as a fallback so the article workspace does not briefly disappear.
 */
export function isReaderZoteroTab(tabId: string | undefined, win?: Window): boolean {
  if (!tabId) return false;
  try {
    const mainWindow = (win ?? Zotero.getMainWindow()) as any;
    const tabs = mainWindow?.Zotero_Tabs?._tabs as Array<{ id?: string; type?: string }> | undefined;
    const tab = tabs?.find((entry) => String(entry.id) === tabId);
    if (tab?.type) return tab.type === 'reader';
    return !!Zotero.Reader.getByTabID(tabId) || !!Zotero.Reader._readers?.some((reader: any) => reader.tabID === tabId);
  } catch {
    return false;
  }
}

export function getArticleSessionId(sourceTabId: string): string {
  return `article:${sourceTabId}`;
}

export function getTranslationSessionId(sourceTabId: string): string {
  return `translation:${sourceTabId}`;
}

export function getSessionId(kind: ChatSessionKind, sourceTabId?: string): string | undefined {
  if (kind === 'global-agent') return GLOBAL_AGENT_SESSION_ID;
  if (!sourceTabId) return undefined;
  return kind === 'translation' ? getTranslationSessionId(sourceTabId) : getArticleSessionId(sourceTabId);
}

export function getSessionKind(sessionId: string): ChatSessionKind {
  if (sessionId === GLOBAL_AGENT_SESSION_ID) return 'global-agent';
  if (sessionId.startsWith('translation:')) return 'translation';
  return 'article';
}

export function getTranslationRoute(sourceTabId: string, separateTab: boolean): { sessionId: string; sessionKind: ChatSessionKind } {
  return separateTab
    ? { sessionId: getTranslationSessionId(sourceTabId), sessionKind: 'translation' }
    : { sessionId: getArticleSessionId(sourceTabId), sessionKind: 'article' };
}

export function subscribeChatWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyWorkspaceChanged(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (e) {
      ztoolkit.log('[chatWorkspace] listener failed:', e);
    }
  }
}

export function updateSelectedZoteroTab(tabId: string | undefined, isReader: boolean): void {
  selectedZoteroTabId = tabId;
  selectedReaderTabId = isReader ? tabId : undefined;
  if (selectedReaderTabId) lastReaderTabId = selectedReaderTabId;
  notifyWorkspaceChanged();
}

export function getSelectedZoteroTabId(): string | undefined {
  return selectedZoteroTabId;
}

export function getWorkspaceSource(host: ChatWorkspaceHost): string | undefined {
  return host === 'sidebar' ? selectedReaderTabId : (selectedReaderTabId ?? lastReaderTabId);
}

export function getActiveWorkspaceKind(host: ChatWorkspaceHost): ChatSessionKind {
  const sourceTabId = getWorkspaceSource(host);
  if (host === 'sidebar' && !selectedReaderTabId) return 'global-agent';
  if (!sourceTabId) return 'global-agent';
  const saved = activeKindBySource.get(sourceTabId) ?? 'article';
  return saved === 'translation' && !visibleTranslationSources.has(sourceTabId) ? 'article' : saved;
}

export function selectWorkspaceKind(kind: ChatSessionKind, sourceTabId?: string): void {
  const source = sourceTabId ?? selectedReaderTabId ?? lastReaderTabId;
  if (kind === 'translation') {
    if (!source) return;
    visibleTranslationSources.add(source);
    activeKindBySource.set(source, kind);
  } else if (source) {
    activeKindBySource.set(source, kind);
  }
  notifyWorkspaceChanged();
}

export function showTranslationWorkspace(sourceTabId: string): void {
  lastReaderTabId = sourceTabId;
  visibleTranslationSources.add(sourceTabId);
  activeKindBySource.set(sourceTabId, 'translation');
  notifyWorkspaceChanged();
}

export function hideTranslationWorkspace(sourceTabId: string): void {
  visibleTranslationSources.delete(sourceTabId);
  if (activeKindBySource.get(sourceTabId) === 'translation') {
    activeKindBySource.set(sourceTabId, 'article');
  }
  notifyWorkspaceChanged();
}

export function isTranslationWorkspaceVisible(sourceTabId?: string): boolean {
  return !!sourceTabId && visibleTranslationSources.has(sourceTabId);
}

export function setSeparateTranslationEnabled(enabled: boolean): void {
  if (!enabled) {
    visibleTranslationSources.clear();
    for (const [sourceTabId, kind] of Array.from(activeKindBySource.entries())) {
      if (kind === 'translation') activeKindBySource.set(sourceTabId, 'article');
    }
  }
  notifyWorkspaceChanged();
}

export function removeWorkspaceSource(sourceTabId: string, notify: boolean = true): void {
  activeKindBySource.delete(sourceTabId);
  visibleTranslationSources.delete(sourceTabId);
  if (selectedReaderTabId === sourceTabId) selectedReaderTabId = undefined;
  if (lastReaderTabId === sourceTabId) lastReaderTabId = undefined;
  if (notify) notifyWorkspaceChanged();
}

export function getWorkspaceSnapshot(host: ChatWorkspaceHost): {
  sourceTabId?: string;
  selectedReaderTabId?: string;
  activeKind: ChatSessionKind;
  translationVisible: boolean;
  articleAvailable: boolean;
} {
  const sourceTabId = getWorkspaceSource(host);
  return {
    sourceTabId,
    selectedReaderTabId,
    activeKind: getActiveWorkspaceKind(host),
    translationVisible: isTranslationWorkspaceVisible(sourceTabId),
    articleAvailable: !!sourceTabId,
  };
}

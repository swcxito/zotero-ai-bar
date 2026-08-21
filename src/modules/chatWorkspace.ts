export type ChatSessionKind = 'article' | 'translation' | 'global-agent';
export type ChatWorkspaceHost = 'sidebar' | 'window';

export const GLOBAL_AGENT_SESSION_ID = 'global-agent';

/**
 * The article/global workspace choice is shared by every reader. A reader's
 * chat session is still independent, but switching readers must not silently
 * switch the workspace kind back to that reader's previous choice.
 */
let sharedWorkspaceKind: Exclude<ChatSessionKind, 'translation'> = 'article';
const visibleTranslationSources = new Set<string>();
let activeTranslationSourceTabId: string | undefined;
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
  if (activeTranslationSourceTabId === sourceTabId && visibleTranslationSources.has(sourceTabId)) return 'translation';
  return sharedWorkspaceKind;
}

export function selectWorkspaceKind(kind: ChatSessionKind, sourceTabId?: string): void {
  const source = sourceTabId ?? selectedReaderTabId ?? lastReaderTabId;
  if (kind === 'translation') {
    if (!source) return;
    visibleTranslationSources.add(source);
    activeTranslationSourceTabId = source;
  } else {
    sharedWorkspaceKind = kind;
    if (source === activeTranslationSourceTabId) activeTranslationSourceTabId = undefined;
  }
  notifyWorkspaceChanged();
}

export function showTranslationWorkspace(sourceTabId: string): void {
  lastReaderTabId = sourceTabId;
  visibleTranslationSources.add(sourceTabId);
  activeTranslationSourceTabId = sourceTabId;
  notifyWorkspaceChanged();
}

export function hideTranslationWorkspace(sourceTabId: string): void {
  visibleTranslationSources.delete(sourceTabId);
  if (activeTranslationSourceTabId === sourceTabId) activeTranslationSourceTabId = undefined;
  notifyWorkspaceChanged();
}

export function isTranslationWorkspaceVisible(sourceTabId?: string): boolean {
  return !!sourceTabId && visibleTranslationSources.has(sourceTabId);
}

export function setSeparateTranslationEnabled(enabled: boolean): void {
  if (!enabled) {
    visibleTranslationSources.clear();
    activeTranslationSourceTabId = undefined;
  }
  notifyWorkspaceChanged();
}

export function removeWorkspaceSource(sourceTabId: string, notify: boolean = true): void {
  visibleTranslationSources.delete(sourceTabId);
  if (activeTranslationSourceTabId === sourceTabId) activeTranslationSourceTabId = undefined;
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

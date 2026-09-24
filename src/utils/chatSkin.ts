import { config } from '../../package.json';
import { getPref } from './prefs';

export const CHAT_SKINS = ['rose', 'paper', 'abyss', 'moss', 'tactical', 'bw'] as const;
export type ChatSkin = (typeof CHAT_SKINS)[number];

const roots = new Set<WeakRef<Element>>();
let knownRoots = new WeakSet<Element>();
let observer: symbol | undefined;

export function normalizeChatSkin(value: unknown): ChatSkin {
  return typeof value === 'string' && CHAT_SKINS.includes(value as ChatSkin) ? (value as ChatSkin) : 'rose';
}

export function getChatSkin(): ChatSkin {
  return normalizeChatSkin(getPref('chat.skin'));
}

/** Mark only plugin-owned DOM. The stylesheet never changes Zotero chrome. */
export function registerChatSkinRoot(root: Element): void {
  root.setAttribute('data-zaibar-skin', getChatSkin());
  if (knownRoots.has(root)) return;
  knownRoots.add(root);
  roots.add(new WeakRef(root));
}

export function refreshChatSkin(): void {
  const skin = getChatSkin();
  for (const ref of roots) {
    const root = ref.deref();
    if (!root) {
      roots.delete(ref);
      continue;
    }
    root.setAttribute('data-zaibar-skin', skin);
  }
}

export function startChatSkinSync(): void {
  if (observer) return;
  observer = Zotero.Prefs.registerObserver(`${config.prefsPrefix}.chat.skin`, refreshChatSkin, true);
}

export function stopChatSkinSync(): void {
  if (observer) Zotero.Prefs.unregisterObserver(observer);
  observer = undefined;
  roots.clear();
  knownRoots = new WeakSet<Element>();
}

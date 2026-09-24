import { config } from '../../package.json';
import { getPref } from './prefs';

export const CHAT_SKINS = ['rose', 'paper', 'abyss', 'moss', 'tactical', 'bw'] as const;
export type ChatSkin = (typeof CHAT_SKINS)[number];

const roots = new Set<WeakRef<Element>>();
const transitionTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
const SKIN_TRANSITION_MS = 320;
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
  const transitioning: Element[] = [];
  for (const ref of roots) {
    const root = ref.deref();
    if (!root) {
      roots.delete(ref);
      continue;
    }
    if (root.getAttribute('data-zaibar-skin') === skin) continue;
    if (!root.isConnected || root.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)')?.matches) {
      root.setAttribute('data-zaibar-skin', skin);
      continue;
    }
    root.setAttribute('data-zaibar-skin-transition', '');
    transitioning.push(root);
  }
  // Install the transition before changing tokens so Gecko has a painted
  // starting value, including for roots inside a Shadow DOM.
  for (const root of transitioning) root.getBoundingClientRect();
  for (const root of transitioning) {
    const previousTimer = transitionTimers.get(root);
    if (previousTimer) clearTimeout(previousTimer);
    root.setAttribute('data-zaibar-skin', skin);
    transitionTimers.set(
      root,
      setTimeout(() => {
        root.removeAttribute('data-zaibar-skin-transition');
        transitionTimers.delete(root);
      }, SKIN_TRANSITION_MS)
    );
  }
}

export function startChatSkinSync(): void {
  if (observer) return;
  observer = Zotero.Prefs.registerObserver(`${config.prefsPrefix}.chat.skin`, refreshChatSkin, true);
}

export function stopChatSkinSync(): void {
  if (observer) Zotero.Prefs.unregisterObserver(observer);
  observer = undefined;
  for (const ref of roots) {
    const root = ref.deref();
    if (!root) continue;
    const timer = transitionTimers.get(root);
    if (timer) clearTimeout(timer);
    transitionTimers.delete(root);
    root.removeAttribute('data-zaibar-skin-transition');
  }
  roots.clear();
  knownRoots = new WeakSet<Element>();
}

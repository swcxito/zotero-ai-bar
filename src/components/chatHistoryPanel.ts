import { config } from '../../package.json';
import type { Session } from '../modules/chatManager';
import type { PersistedConversation } from '../modules/chatHistoryStore';
import { getString } from '../utils/locale';

export interface ChatHistoryPanelOptions {
  onActivate: (conversationId: string) => void | Promise<void>;
  onCurrentDeleted: () => void | Promise<void>;
  onClose: () => void;
}

type HistoryFilter = 'all' | 'favorite';

function setButtonStyle(button: HTMLButtonElement, active = false): void {
  button.style.display = 'inline-flex';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.border = '0';
  button.style.borderRadius = '7px';
  button.style.padding = '5px 9px';
  button.style.cursor = 'pointer';
  button.style.color = 'var(--fill-primary, currentColor)';
  button.style.background = active ? 'var(--material-button, rgba(127, 127, 127, .18))' : 'transparent';
}

function setIconButtonStyle(button: HTMLButtonElement): void {
  setButtonStyle(button);
  button.style.width = '28px';
  button.style.height = '28px';
  button.style.padding = '6px';
  button.style.flex = '0 0 auto';
  button.style.lineHeight = '0';
  button.style.backgroundPosition = 'center';
  button.style.backgroundRepeat = 'no-repeat';
  button.style.backgroundSize = '16px 16px';
  button.style.setProperty('-moz-context-properties', 'fill, stroke');
  button.style.setProperty('fill', 'currentColor');
  button.style.setProperty('stroke', 'currentColor');
}

function setButtonIcon(button: HTMLButtonElement, filename: string): void {
  button.replaceChildren();
  button.style.backgroundImage = `url("chrome://${config.addonRef}/content/icons/${filename}")`;
}

function previewText(conversation: PersistedConversation): string {
  const turn = conversation.turns.at(-1);
  return (turn?.userText || turn?.assistantMarkdown || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>#~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function prefersReducedMotion(doc: Document): boolean {
  return doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

function animateElement(element: HTMLElement, keyframes: Keyframe[], duration: number): Animation | undefined {
  if (prefersReducedMotion(element.ownerDocument) || typeof element.animate !== 'function') return undefined;
  return element.animate(keyframes, { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
}

export function ChatHistoryPanel(doc: Document, session: Session, options: ChatHistoryPanelOptions): HTMLElement {
  const root = doc.createElement('div') as HTMLElement & { _disposeHistory?: () => void };
  root.classList.add('zaibar-history-panel');
  root.style.cssText =
    'display:flex;flex:1;min-width:0;width:100%;max-width:100%;min-height:0;flex-direction:column;overflow:hidden;padding:8px;box-sizing:border-box;';

  const toolbar = doc.createElement('div');
  toolbar.style.cssText = 'display:flex;align-items:center;min-width:0;min-height:32px;gap:4px;margin-bottom:8px;';

  const back = doc.createElement('button');
  back.type = 'button';
  back.title = getString('history-back' as any);
  back.setAttribute('aria-label', back.title);
  setIconButtonStyle(back);
  setButtonIcon(back, 'arrow-left.svg');
  back.addEventListener('click', options.onClose);

  const heading = doc.createElement('strong');
  heading.textContent = getString('history-title' as any);
  heading.style.cssText = 'display:flex;align-items:center;align-self:stretch;min-width:0;margin-inline-end:auto;line-height:1.2;';

  const all = doc.createElement('button');
  all.type = 'button';
  all.textContent = getString('history-filter-all' as any);

  const favorites = doc.createElement('button');
  favorites.type = 'button';
  favorites.textContent = getString('history-filter-favorite' as any);
  toolbar.append(back, heading, all, favorites);

  const list = doc.createElement('div');
  list.style.cssText =
    'display:flex;min-width:0;width:100%;max-width:100%;min-height:0;flex:1;box-sizing:border-box;flex-direction:column;gap:6px;overflow-y:auto;overflow-x:hidden;';
  root.append(toolbar, list);

  let filter: HistoryFilter = 'all';
  let renderSequence = 0;
  let suppressNextHistoryRefresh = false;
  let pendingDelete:
    | {
        row: HTMLElement;
        button: HTMLButtonElement;
      }
    | undefined;

  const collapsedRowColumns = '28px minmax(0,1fr) 28px 28px';
  const deleteTransitionDuration = prefersReducedMotion(doc) ? '0ms' : '180ms';

  const resetDeleteRow = (row: HTMLElement, button: HTMLButtonElement) => {
    delete row.dataset.confirmDelete;
    row.style.gridTemplateColumns = collapsedRowColumns;
    button.title = getString('history-delete' as any);
    button.setAttribute('aria-label', button.title);
    button.removeAttribute('aria-expanded');
    setIconButtonStyle(button);
    button.style.width = '100%';
    button.style.transition = `background-color ${deleteTransitionDuration} cubic-bezier(.22,1,.36,1),color ${deleteTransitionDuration} cubic-bezier(.22,1,.36,1),border-radius ${deleteTransitionDuration} cubic-bezier(.22,1,.36,1),padding ${deleteTransitionDuration} cubic-bezier(.22,1,.36,1)`;
    button.style.overflow = '';
    button.style.whiteSpace = '';
    button.style.fontSize = '';
    button.style.fontWeight = '';
    button.style.lineHeight = '0';
    button.replaceChildren();
    button.style.backgroundImage = 'url("chrome://zotero/skin/16/universal/empty-trash.svg")';
  };

  const cancelPendingDelete = () => {
    const pending = pendingDelete;
    if (!pending) return;
    pendingDelete = undefined;
    resetDeleteRow(pending.row, pending.button);
  };

  const enterDeleteConfirmation = (row: HTMLElement, button: HTMLButtonElement) => {
    cancelPendingDelete();
    pendingDelete = { row, button };
    row.dataset.confirmDelete = 'true';
    const label = getString('history-delete-confirm' as any);
    button.replaceChildren(label);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', 'true');
    button.style.backgroundImage = 'none';
    button.style.width = '100%';
    button.style.minWidth = '0';
    button.style.padding = '5px 10px';
    button.style.overflow = 'hidden';
    button.style.whiteSpace = 'nowrap';
    button.style.fontSize = '12px';
    button.style.fontWeight = '600';
    button.style.lineHeight = '1';
    button.style.color = '#fff';
    button.style.backgroundColor = '#d70015';
    button.style.borderRadius = '7px';

    // scrollWidth includes the label's intrinsic width even while the grid
    // still constrains the button to its collapsed 28px track.
    const expandedWidth = Math.max(72, Math.ceil(button.scrollWidth) + 2);
    row.style.gridTemplateColumns = `28px minmax(0,1fr) 28px ${expandedWidth}px`;
  };

  const cancelDeleteOnOutsideClick = (event: MouseEvent) => {
    if (!pendingDelete || pendingDelete.button.contains(event.target as Node)) return;
    // The first click elsewhere only dismisses the destructive action. This
    // prevents that same click from also opening, renaming, or favoriting a
    // conversation underneath it.
    event.preventDefault();
    event.stopPropagation();
    cancelPendingDelete();
  };
  doc.addEventListener('click', cancelDeleteOnOutsideClick, true);

  const updateFilterButtons = () => {
    const busy = !!session.pending.abortController;
    setButtonStyle(all, filter === 'all');
    setButtonStyle(favorites, filter === 'favorite');
    back.disabled = busy;
    all.disabled = busy;
    favorites.disabled = busy;
  };

  const renderListContents = () => {
    pendingDelete = undefined;
    list.replaceChildren();
    updateFilterButtons();
    const allConversations = addon.chatManager.listConversations(session);
    const conversations = filter === 'favorite' ? allConversations.filter((conversation) => conversation.favorite) : allConversations;
    if (!conversations.length) {
      const empty = doc.createElement('div');
      empty.textContent = getString((filter === 'favorite' ? 'history-empty-favorite' : 'history-empty') as any);
      empty.style.cssText = 'padding:36px 12px;text-align:center;color:var(--fill-secondary,currentColor);opacity:.72;';
      list.appendChild(empty);
      return;
    }

    for (const conversation of conversations) {
      const row = doc.createElement('div');
      row.dataset.conversationId = conversation.id;
      row.style.cssText =
        'display:grid;grid-template-columns:28px minmax(0,1fr) 28px 28px;align-items:center;min-width:0;width:100%;max-width:100%;box-sizing:border-box;gap:3px;padding:7px 5px;border:1px solid var(--color-border,#d9dfe3);border-radius:9px;';
      row.style.transition = `grid-template-columns ${deleteTransitionDuration} cubic-bezier(.22,1,.36,1)`;
      if (conversation.id === session.conversationId) row.style.background = 'var(--material-button, rgba(127,127,127,.12))';
      const busy = !!session.pending.abortController;

      const favorite = doc.createElement('button');
      favorite.type = 'button';
      favorite.title = getString((conversation.favorite ? 'history-unfavorite' : 'history-favorite') as any);
      favorite.setAttribute('aria-label', favorite.title);
      favorite.disabled = busy;
      setIconButtonStyle(favorite);
      setButtonIcon(favorite, conversation.favorite ? 'star-filled.svg' : 'star.svg');
      favorite.style.color = conversation.favorite ? '#e11d48' : 'var(--fill-secondary,currentColor)';
      favorite.addEventListener('click', () => {
        suppressNextHistoryRefresh = true;
        const isFavorite = addon.chatManager.toggleFavorite(conversation.id);
        favorite.title = getString((isFavorite ? 'history-unfavorite' : 'history-favorite') as any);
        favorite.setAttribute('aria-label', favorite.title);
        favorite.style.color = isFavorite ? '#e11d48' : 'var(--fill-secondary,currentColor)';
        setButtonIcon(favorite, isFavorite ? 'star-filled.svg' : 'star.svg');
        const target = filter === 'favorite' && !isFavorite ? row : favorite;
        const animation = animateElement(
          target,
          target === row
            ? [
                { opacity: 1, transform: 'translateY(0)' },
                { opacity: 0, transform: 'translateY(-4px)' },
              ]
            : [
                { transform: 'scale(1) rotate(0deg)' },
                { transform: 'scale(1.28) rotate(12deg)', offset: 0.5 },
                { transform: 'scale(1) rotate(0deg)' },
              ],
          160
        );
        if (animation) void animation.finished.then(() => renderListContents()).catch(() => renderListContents());
        else renderListContents();
      });

      const main = doc.createElement('div');
      main.style.cssText = 'min-width:0;width:100%;';
      const content = doc.createElement('button');
      content.type = 'button';
      content.disabled = busy;
      content.style.cssText =
        'display:block;min-width:0;width:100%;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:1px 3px;box-sizing:border-box;';
      const title = doc.createElement('div');
      title.textContent = conversation.title || getString('history-default-title' as any);
      title.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;';
      const meta = doc.createElement('div');
      const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(conversation.lastMessageAt));
      const preview = previewText(conversation);
      meta.textContent = preview ? `${date} · ${preview}` : date;
      meta.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.66;margin-top:2px;';
      content.append(title, meta);
      content.addEventListener('click', async () => {
        if (!addon.chatManager.activateConversation(session, conversation.id)) return;
        await options.onActivate(conversation.id);
      });
      main.appendChild(content);

      const rename = doc.createElement('button');
      rename.type = 'button';
      rename.title = getString('history-rename' as any);
      rename.setAttribute('aria-label', rename.title);
      rename.disabled = busy;
      setIconButtonStyle(rename);
      setButtonIcon(rename, 'pencil.svg');
      rename.addEventListener('click', () => {
        const input = doc.createElement('input');
        input.value = conversation.title;
        input.maxLength = 120;
        input.style.cssText =
          'width:100%;min-width:0;box-sizing:border-box;border:1px solid var(--color-border,#d9dfe3);border-radius:5px;padding:4px 6px;background:var(--material-background,#fff);color:inherit;';
        for (const eventName of ['pointerdown', 'mousedown', 'click', 'dblclick']) {
          input.addEventListener(eventName, (event) => event.stopPropagation());
        }
        content.replaceWith(input);
        input.focus();
        input.select();
        let finished = false;
        const finish = (save: boolean) => {
          if (finished) return;
          finished = true;
          if (save && input.value.trim()) {
            suppressNextHistoryRefresh = true;
            addon.chatManager.renameConversation(conversation.id, input.value);
          }
          renderListContents();
        };
        input.addEventListener('keydown', (event) => {
          event.stopPropagation();
          if (event.key === 'Enter') finish(true);
          if (event.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
      });

      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.title = getString('history-delete' as any);
      remove.setAttribute('aria-label', remove.title);
      remove.disabled = busy;
      setIconButtonStyle(remove);
      remove.style.width = '100%';
      remove.style.transition = `background-color ${deleteTransitionDuration} cubic-bezier(.22,1,.36,1),color ${deleteTransitionDuration} cubic-bezier(.22,1,.36,1),border-radius ${deleteTransitionDuration} cubic-bezier(.22,1,.36,1),padding ${deleteTransitionDuration} cubic-bezier(.22,1,.36,1)`;
      remove.style.backgroundImage = 'url("chrome://zotero/skin/16/universal/empty-trash.svg")';
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (pendingDelete?.button !== remove) {
          enterDeleteConfirmation(row, remove);
          return;
        }

        pendingDelete = undefined;
        remove.disabled = true;
        const wasCurrent = conversation.id === session.conversationId;
        suppressNextHistoryRefresh = true;
        if (!addon.chatManager.deleteConversation(session, conversation.id)) {
          suppressNextHistoryRefresh = false;
          remove.disabled = busy;
          resetDeleteRow(row, remove);
          return;
        }
        if (wasCurrent) await options.onCurrentDeleted();
        const animation = animateElement(
          row,
          [
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0, transform: 'translateY(-4px)' },
          ],
          140
        );
        if (animation) void animation.finished.then(() => renderListContents()).catch(() => renderListContents());
        else renderListContents();
      });
      row.append(favorite, main, rename, remove);
      list.appendChild(row);
    }
  };

  const renderList = (animate = false) => {
    const sequence = ++renderSequence;
    if (!animate || prefersReducedMotion(doc) || typeof list.animate !== 'function') {
      renderListContents();
      return;
    }
    const exitAnimation = list.animate(
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-4px)' },
      ],
      { duration: 70, easing: 'ease-in' }
    );
    void exitAnimation.finished
      .then(() => {
        if (sequence !== renderSequence) return;
        renderListContents();
        animateElement(
          list,
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          140
        );
      })
      .catch(() => undefined);
  };

  all.addEventListener('click', () => {
    if (filter === 'all') return;
    filter = 'all';
    updateFilterButtons();
    renderList(true);
  });
  favorites.addEventListener('click', () => {
    if (filter === 'favorite') return;
    filter = 'favorite';
    updateFilterButtons();
    renderList(true);
  });

  let unsubscribe: () => void = () => undefined;
  const dispose = () => {
    cancelPendingDelete();
    doc.removeEventListener('click', cancelDeleteOnOutsideClick, true);
    unsubscribe();
  };
  unsubscribe = addon.chatManager.subscribeHistory(() => {
    if (!root.isConnected) {
      dispose();
      return;
    }
    if (suppressNextHistoryRefresh) {
      suppressNextHistoryRefresh = false;
      return;
    }
    renderList();
  });
  root._disposeHistory = dispose;
  renderList();
  return root;
}

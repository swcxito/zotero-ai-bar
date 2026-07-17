import { InputArea } from '../components/inputArea';
import { renderMarkdown } from '../utils/markdown';
import { getReaderSourceLabel } from './readerBarPopup';
import { attachCitationHandlers } from './chatUI';

export const CHAT_WINDOW_MESSAGE_CONTAINER_ID = 'ai-bar-window-message-container';

function getMessageContainer(doc: Document) {
  return doc.querySelector(`#${CHAT_WINDOW_MESSAGE_CONTAINER_ID}`) as HTMLElement | null;
}

export function ensureChatWindowUI(doc: Document) {
  const root = doc.querySelector('#ai-bar-window-root') as HTMLElement | null;
  if (!root) return;

  if (getMessageContainer(doc)) return;

  const messageContainer = doc.createElement('div');
  messageContainer.id = CHAT_WINDOW_MESSAGE_CONTAINER_ID;
  messageContainer.classList.add(
    'message-container',
    'flex',
    'flex-col',
    'flex-1',
    'min-w-0',
    'overflow-y-auto',
    'overflow-x-hidden',
    'px-1',
    'pb-2'
  );
  messageContainer.style.userSelect = 'text';

  const inputArea = InputArea(doc, addon.chatManager.currentTabID!, {
    sourceLabel: getReaderSourceLabel(addon.data.selection.currentReader),
    onRenderUserBubble: async (bubble, text) => {
      if (text) {
        const msgEl = bubble.querySelector('.chat-message') as HTMLElement | null;
        if (msgEl) {
          msgEl.innerHTML = await renderMarkdown(text, addon.chatManager.sessionsMap.get(addon.chatManager.currentTabID!)?.itemId);
          attachCitationHandlers(msgEl as HTMLElement);
          (msgEl as any).dataset.markdown = text;
        }
      }
    },
  });
  inputArea.style.userSelect = 'none';

  root.appendChild(messageContainer);
  root.appendChild(inputArea);
}

export function onChatWindowLoad(window: Window) {
  ensureChatWindowUI(window.document);
  window.addEventListener('unload', () => {
    if (window.arguments?.[0]?.onWindowClosed) {
      window.arguments[0].onWindowClosed();
    }
  });
}

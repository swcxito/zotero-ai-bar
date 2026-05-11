import { ChatBox } from '../components/chatBox';
import { InputArea } from '../components/inputArea';
import { createImageViewer } from '../components/imagePreview';
import { renderMarkdown } from '../utils/markdown';
import { getString } from '../utils/locale';
import { getReaderSourceLabel } from './readerBarPopup';
import { checkModelSupportsImage } from '../utils/providers';

export const CHAT_WINDOW_MESSAGE_CONTAINER_ID = 'ai-bar-window-message-container';

function getMessageContainer(doc: Document) {
  return doc.querySelector(`#${CHAT_WINDOW_MESSAGE_CONTAINER_ID}`) as HTMLElement | null;
}

function updateSendButtonState(input: HTMLTextAreaElement, sendBtn: HTMLButtonElement) {
  const hasText = input.value.trim().length > 0;
  const hasImages = (addon.data.inputImages.get(addon.chatManager.currentTabID) || []).length > 0;
  const canSend = hasText || hasImages;
  sendBtn.disabled = !canSend;
  if (canSend) {
    sendBtn.classList.remove('bg-slate-200', 'dark:bg-neutral-800', 'text-slate-400', 'dark:text-neutral-600');
    sendBtn.classList.add('bg-rose-500', 'dark:bg-rose-600', 'hover:bg-rose-600');
  } else {
    sendBtn.classList.add('bg-slate-200', 'dark:bg-neutral-800', 'text-slate-400', 'dark:text-neutral-600');
    sendBtn.classList.remove('bg-rose-500', 'dark:bg-rose-600', 'hover:bg-rose-600');
  }
}

async function submitFromWindowInput(doc: Document, input: HTMLTextAreaElement, sendBtn: HTMLButtonElement, inputAreaWrapper?: HTMLElement) {
  const content = input.value.trim();
  const hasImages = (addon.data.inputImages.get(addon.chatManager.currentTabID) || []).length > 0;
  if (!content && !hasImages) return;

  const container = getMessageContainer(doc);
  if (!container) return;

  // Read images — check model support before clearing preview
  const imageUrls = addon.data.inputImages.get(addon.chatManager.currentTabID) || [];
  if (imageUrls.length > 0 && !checkModelSupportsImage()) {
    const services = Zotero.getMainWindow().Services as any;
    const flags =
      services.prompt.BUTTON_POS_0 * services.prompt.BUTTON_TITLE_IS_STRING + services.prompt.BUTTON_POS_1 * services.prompt.BUTTON_TITLE_CANCEL;
    const result = services.prompt.confirmEx(
      Zotero.getMainWindow(),
      getString('image-unsupported-title'),
      getString('image-unsupported-message'),
      flags,
      getString('image-unsupported-send-text'),
      '',
      '',
      '',
      {}
    );
    if (result === 1) return; // user cancelled — keep images in preview
    // user chose "send text only" — clear images and proceed
    addon.data.inputImages.delete(addon.chatManager.currentTabID);
    const api = (inputAreaWrapper as any)?._imagePreviewAPI;
    if (api) api.render();
    imageUrls.length = 0;
  } else if (imageUrls.length > 0) {
    addon.data.inputImages.delete(addon.chatManager.currentTabID);
    const api = (inputAreaWrapper as any)?._imagePreviewAPI;
    if (api) api.render();
  }

  // Wrapper for right-alignment (matching ChatBox user bubble alignment)
  const wrapper = doc.createElement('div');
  wrapper.classList.add(
    'flex',
    'flex-col',
    'items-end',
    'min-w-[160px]',
    'max-w-[85%]',
    'sm:max-w-[75%]',
    'self-end',
    'animate-in',
    'fade-in',
    'slide-in-from-bottom-3',
    'duration-300'
  );

  // Image row above pink bubble (with bottom border when no text)
  if (imageUrls.length > 0) {
    const imgsRow = doc.createElement('div');
    imgsRow.classList.add('flex', 'flex-wrap', 'gap-1.5', 'justify-end', 'pt-1', 'pr-1', 'pb-2');
    if (!content) imgsRow.classList.add('mb-1', 'border-b-2', 'border-rose-500', 'dark:border-rose-600');
    else imgsRow.classList.add('mb-2');
    imageUrls.forEach((dataUrl, idx) => {
      const thumb = doc.createElement('img');
      thumb.src = dataUrl;
      thumb.classList.add(
        'w-14',
        'h-14',
        'object-cover',
        'rounded-lg',
        'cursor-pointer',
        'hover:ring-2',
        'hover:ring-rose-400',
        'dark:hover:ring-rose-600',
        'transition-shadow',
        'flex-shrink-0',
        'shadow-sm',
        'hover:shadow-md'
      );
      thumb.addEventListener('click', () => {
        createImageViewer(imageUrls, idx, doc.body, doc);
      });
      imgsRow.appendChild(thumb);
    });
    wrapper.appendChild(imgsRow);
  }

  // Pink bubble (text only)
  if (content) {
    const userMessage = ChatBox({ doc, isUser: true }) as HTMLElement;
    const userMessageNode = userMessage.querySelector('.chat-message') as HTMLElement | null;
    if (userMessageNode) {
      userMessageNode.innerHTML = await renderMarkdown(content);
      userMessage.dataset.markdown = content;
    }
    wrapper.appendChild(userMessage);
  }

  container.appendChild(wrapper);
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });

  input.value = '';
  input.style.height = 'auto';
  updateSendButtonState(input, sendBtn);

  await addon.chatManager.sendChatRequest({
    userPrompt: content,
    sourceLabel: getReaderSourceLabel(addon.data.selection.currentReader),
    tabId: addon.chatManager.currentTabID,
    images: imageUrls.length > 0 ? imageUrls : undefined,
  });
}

function bindInputArea(doc: Document, inputArea: HTMLElement) {
  const textarea = inputArea.querySelector('textarea') as HTMLTextAreaElement | null;
  const sendBtn = inputArea.querySelectorAll('button')[1] as HTMLButtonElement | undefined;
  if (!(textarea && sendBtn)) return;

  textarea.placeholder = getString('reader-bar-ask-placeholder');

  const syncHeight = () => {
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 140);
    textarea.style.height = `${newHeight}px`;
  };

  textarea.addEventListener('input', () => {
    syncHeight();
    updateSendButtonState(textarea, sendBtn);
  });

  textarea.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      submitFromWindowInput(doc, textarea, sendBtn, inputArea);
    }
  });

  sendBtn.addEventListener('click', () => {
    if (sendBtn.disabled) return;
    submitFromWindowInput(doc, textarea, sendBtn, inputArea);
  });
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

  const inputArea = InputArea(doc, addon.chatManager.currentTabID!);
  bindInputArea(doc, inputArea);

  // 让除消息容器外其它部分不可选
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

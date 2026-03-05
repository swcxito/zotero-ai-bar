import { ChatBox } from "../components/chatBox";
import { InputArea } from "../components/inputArea";
import { renderMarkdown } from "../utils/markdown";
import { getString } from "../utils/locale";
import { getReaderSourceLabel } from "./readerBarPopup";

export const CHAT_WINDOW_MESSAGE_CONTAINER_ID =
  "ai-bar-window-message-container";

function getMessageContainer(doc: Document) {
  return doc.querySelector(
    `#${CHAT_WINDOW_MESSAGE_CONTAINER_ID}`,
  ) as HTMLElement | null;
}

function updateSendButtonState(
  input: HTMLTextAreaElement,
  sendBtn: HTMLButtonElement,
) {
  const hasText = input.value.trim().length > 0;
  sendBtn.disabled = !hasText;
  if (hasText) {
    sendBtn.classList.remove(
      "bg-slate-200",
      "dark:bg-neutral-800",
      "text-slate-400",
      "dark:text-neutral-600",
    );
    sendBtn.classList.add("bg-rose-500", "text-white", "hover:bg-rose-400");
  } else {
    sendBtn.classList.add(
      "bg-slate-200",
      "dark:bg-neutral-800",
      "text-slate-400",
      "dark:text-neutral-600",
    );
    sendBtn.classList.remove("bg-rose-500", "text-white", "hover:bg-rose-400");
  }
}

async function submitFromWindowInput(
  doc: Document,
  input: HTMLTextAreaElement,
  sendBtn: HTMLButtonElement,
) {
  const content = input.value.trim();
  if (!content) return;

  const container = getMessageContainer(doc);
  if (!container) return;

  const userMessage = ChatBox({
    doc,
    annotation: addon.chatManager.currentAnnotation,
    isUser: true,
  }) as HTMLElement;
  const userMessageNode = userMessage.querySelector(
    ".chat-message",
  ) as HTMLElement | null;
  if (userMessageNode) {
    userMessageNode.innerHTML = await renderMarkdown(content);
    userMessage.dataset.markdown = content;
  }
  container.appendChild(userMessage);
  container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });

  input.value = "";
  input.style.height = "auto";
  updateSendButtonState(input, sendBtn);

  await addon.chatManager.sendChatRequest({
    userPrompt: content,
    sourceLabel: getReaderSourceLabel(addon.chatManager.currentReader),
    hostMode: "window",
    sectionId: addon.chatManager.currentSection,
  });
}

function bindInputArea(doc: Document, inputArea: HTMLElement) {
  const textarea = inputArea.querySelector(
    "textarea",
  ) as HTMLTextAreaElement | null;
  const sendBtn = inputArea.querySelectorAll("button")[1] as
    | HTMLButtonElement
    | undefined;
  if (!(textarea && sendBtn)) return;

  textarea.placeholder = getString("reader-bar-ask-placeholder");

  const syncHeight = () => {
    textarea.style.height = "auto";
    const newHeight = Math.min(textarea.scrollHeight, 140);
    textarea.style.height = `${newHeight}px`;
  };

  textarea.addEventListener("input", () => {
    syncHeight();
    updateSendButtonState(textarea, sendBtn);
  });

  textarea.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      submitFromWindowInput(doc, textarea, sendBtn);
    }
  });

  sendBtn.addEventListener("click", () => {
    if (sendBtn.disabled) return;
    submitFromWindowInput(doc, textarea, sendBtn);
  });
}

export function ensureChatWindowUI(doc: Document) {
  const root = doc.querySelector("#ai-bar-window-root") as HTMLElement | null;
  if (!root) return;

  if (getMessageContainer(doc)) return;

  const messageContainer = doc.createElement("div");
  messageContainer.id = CHAT_WINDOW_MESSAGE_CONTAINER_ID;
  messageContainer.classList.add(
    "message-container",
    "flex",
    "flex-col",
    "flex-1",
    "overflow-y-auto",
    "px-1",
    "pb-2",
  );

  const inputArea = InputArea(doc);
  bindInputArea(doc, inputArea);

  root.appendChild(messageContainer);
  root.appendChild(inputArea);
}

export function onChatWindowLoad(window: Window) {
  ensureChatWindowUI(window.document);
  window.addEventListener("unload", () => {
    if (window.arguments?.[0]?.onWindowClosed) {
      window.arguments[0].onWindowClosed();
    }
  });
}

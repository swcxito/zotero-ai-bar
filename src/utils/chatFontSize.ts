import { getPref } from './prefs';

export const CHAT_FONT_SIZE_LEVELS = [13, 14, 15, 16, 18] as const;
export const DEFAULT_CHAT_FONT_SIZE_INDEX = 2;
const CHAT_AUXILIARY_FONT_SIZE = 11;

export function normalizeChatFontSizeIndex(value: unknown): number {
  const index = Number(value);
  if (!Number.isFinite(index)) return DEFAULT_CHAT_FONT_SIZE_INDEX;
  return Math.min(CHAT_FONT_SIZE_LEVELS.length - 1, Math.max(0, Math.round(index)));
}

export function getChatFontSizeValue(index: unknown = getPref('chat.fontSize')): string {
  return `${CHAT_FONT_SIZE_LEVELS[normalizeChatFontSizeIndex(index)]}px`;
}

export function getChatAuxiliaryFontSizeValue(index: unknown = getPref('chat.fontSize')): string {
  const chatFontSize = CHAT_FONT_SIZE_LEVELS[normalizeChatFontSizeIndex(index)];
  const defaultChatFontSize = CHAT_FONT_SIZE_LEVELS[DEFAULT_CHAT_FONT_SIZE_INDEX];
  return `${(CHAT_AUXILIARY_FONT_SIZE * chatFontSize) / defaultChatFontSize}px`;
}

export function applyChatFontSize(messageContainer: HTMLElement): void {
  messageContainer.style.setProperty('--zaibar-chat-font-size', getChatFontSizeValue());
}

export function applyChatAuxiliaryFontSize(root: HTMLElement): void {
  const fontSize = getChatAuxiliaryFontSizeValue();
  const selector = '.selection-hint-text, .chat-reference-card, .chat-reference-toggle';
  const elements = root.matches(selector) ? [root, ...root.querySelectorAll<HTMLElement>(selector)] : root.querySelectorAll<HTMLElement>(selector);
  for (const element of elements) {
    element.style.fontSize = fontSize;
  }
}

export function applyChatInputFontSize(inputArea: HTMLElement): void {
  const textarea = inputArea.querySelector('textarea') as HTMLTextAreaElement | null;
  if (textarea) textarea.style.fontSize = getChatFontSizeValue();
  applyChatAuxiliaryFontSize(inputArea);
}

export function refreshChatFontSize(): void {
  const containers = new Set<HTMLElement>();
  for (const page of addon.data.sidePaneBodyMap?.values() ?? []) {
    const directContainer = page.querySelector('.message-container') as HTMLElement | null;
    if (directContainer) containers.add(directContainer);

    const chatRoot = page.querySelector('#ai-bar-chat-root') as HTMLElement | null;
    const shadowContainer = chatRoot?.shadowRoot?.querySelector('.message-container') as HTMLElement | null;
    if (shadowContainer) containers.add(shadowContainer);
  }

  for (const container of containers) {
    applyChatFontSize(container);
    applyChatAuxiliaryFontSize(container);
  }
  for (const inputArea of addon.data.sharedInputAreas ?? []) applyChatInputFontSize(inputArea);
}

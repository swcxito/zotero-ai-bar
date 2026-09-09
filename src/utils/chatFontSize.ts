import { getPref } from './prefs';

export const CHAT_FONT_SIZE_LEVELS = [13, 14, 15, 16, 18] as const;
export const DEFAULT_CHAT_FONT_SIZE_INDEX = 2;

export function normalizeChatFontSizeIndex(value: unknown): number {
  const index = Number(value);
  if (!Number.isFinite(index)) return DEFAULT_CHAT_FONT_SIZE_INDEX;
  return Math.min(CHAT_FONT_SIZE_LEVELS.length - 1, Math.max(0, Math.round(index)));
}

export function getChatFontSizeValue(index: unknown = getPref('chat.fontSize')): string {
  return `${CHAT_FONT_SIZE_LEVELS[normalizeChatFontSizeIndex(index)]}px`;
}

export function applyChatFontSize(messageContainer: HTMLElement): void {
  messageContainer.style.setProperty('--zaibar-chat-font-size', getChatFontSizeValue());
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

  for (const container of containers) applyChatFontSize(container);
}

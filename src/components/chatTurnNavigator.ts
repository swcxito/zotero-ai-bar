/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * chatTurnNavigator.ts
 *
 * This file is part of Zotero AI Bar.
 */

import { renderedElementToPlainText } from '../utils/chatSelectionCopy';
import { getString } from '../utils/locale';

export const CHAT_TURN_NAVIGATOR_MIN_WIDTH = 520;
export const CHAT_INPUT_MAX_WIDTH_REM = 48;

export type ChatTurnRole = 'user' | 'assistant';

export interface PairedTurnIndexes {
  userIndex?: number;
  assistantIndex?: number;
}

export interface MarkerGroupMaskBounds {
  top: number;
  height: number;
}

interface ChatTurnNodes {
  user?: HTMLElement;
  assistant?: HTMLElement;
  anchor: HTMLElement;
}

export interface ChatTurnNavigatorMount {
  shell: HTMLElement;
  refresh: () => void;
  dispose: () => void;
}

type ChatTurnNavigatorHost = HTMLElement & {
  _disposeTurnNavigator?: () => void;
};

const NAVIGATOR_INSET = 16;
const MARKER_GAP = 10;
const MASK_VERTICAL_PADDING = 18;
const ACTIVE_PROBE_RATIO = 0.28;

export function getChatInputMaxWidth(rootFontSizePx: number): number {
  return Math.max(0, rootFontSizePx) * CHAT_INPUT_MAX_WIDTH_REM;
}

export function shouldUseCompactNavigator(containerWidth: number, rootFontSizePx: number): boolean {
  return containerWidth < getChatInputMaxWidth(rootFontSizePx);
}

export function pairChatTurnRoles(roles: ChatTurnRole[]): PairedTurnIndexes[] {
  const turns: PairedTurnIndexes[] = [];
  let pendingUserTurn = -1;

  roles.forEach((role, index) => {
    if (role === 'user') {
      turns.push({ userIndex: index });
      pendingUserTurn = turns.length - 1;
      return;
    }

    if (pendingUserTurn >= 0 && turns[pendingUserTurn].assistantIndex === undefined) {
      turns[pendingUserTurn].assistantIndex = index;
      pendingUserTurn = -1;
    } else {
      turns.push({ assistantIndex: index });
    }
  });

  return turns;
}

export function getCenteredMarkerPositions(count: number, height: number, preferredGap = MARKER_GAP, inset = NAVIGATOR_INSET): number[] {
  if (count <= 0 || height <= 0) return [];
  const safeInset = Math.max(0, Math.min(inset, height / 2));
  if (count === 1) return [height / 2];
  const usableHeight = Math.max(0, height - safeInset * 2);
  const gap = Math.min(Math.max(0, preferredGap), usableHeight / (count - 1));
  const groupHeight = gap * (count - 1);
  const start = (height - groupHeight) / 2;
  return Array.from({ length: count }, (_value, index) => start + gap * index);
}

export function getHoverMarkerWidth(index: number, hoveredIndex: number): number {
  return Math.max(8, 26 - Math.abs(index - hoveredIndex) * 6);
}

export function getMarkerGroupMaskBounds(
  positions: number[],
  containerHeight: number,
  padding = MASK_VERTICAL_PADDING
): MarkerGroupMaskBounds | undefined {
  if (!positions.length || containerHeight <= 0) return undefined;
  const safePadding = Math.max(0, padding);
  const top = Math.max(0, positions[0] - safePadding);
  const bottom = Math.min(containerHeight, positions[positions.length - 1] + safePadding);
  return { top, height: Math.max(0, bottom - top) };
}

export function getActiveTurnIndex(
  anchorOffsets: number[],
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  probeRatio = ACTIVE_PROBE_RATIO
): number {
  if (!anchorOffsets.length) return -1;
  if (scrollHeight - scrollTop - clientHeight <= 2) return anchorOffsets.length - 1;

  const probe = scrollTop + clientHeight * probeRatio;
  let activeIndex = 0;
  for (let index = 0; index < anchorOffsets.length; index++) {
    if (anchorOffsets[index] > probe) break;
    activeIndex = index;
  }
  return activeIndex;
}

function getDirectTurnNodes(container: HTMLElement): ChatTurnNodes[] {
  const roleNodes = Array.from(container.children)
    .map((element) => ({ element: element as HTMLElement, role: (element as HTMLElement).dataset.chatRole }))
    .filter((entry): entry is { element: HTMLElement; role: ChatTurnRole } => entry.role === 'user' || entry.role === 'assistant');
  const pairs = pairChatTurnRoles(roleNodes.map((entry) => entry.role));
  return pairs.map((pair) => {
    const user = pair.userIndex === undefined ? undefined : roleNodes[pair.userIndex].element;
    const assistant = pair.assistantIndex === undefined ? undefined : roleNodes[pair.assistantIndex].element;
    return { user, assistant, anchor: user ?? assistant! };
  });
}

function elementsMatch(left: ChatTurnNodes[], right: ChatTurnNodes[]): boolean {
  return (
    left.length === right.length &&
    left.every((turn, index) => turn.user === right[index].user && turn.assistant === right[index].assistant && turn.anchor === right[index].anchor)
  );
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getUserPreview(turn: ChatTurnNodes): string {
  const preview = turn.user?.dataset.chatPreviewText;
  if (preview?.trim()) return collapseWhitespace(preview);
  return getString('chat-turn-navigator-empty-user' as any);
}

function getAssistantPreview(turn: ChatTurnNodes): string {
  const preview = turn.assistant?.dataset.chatPreviewText;
  if (preview === undefined) return getString('chat-turn-navigator-generating' as any);
  return collapseWhitespace(preview) || getString('chat-turn-navigator-empty-assistant' as any);
}

export function captureAssistantPreviewSnapshot(assistant: HTMLElement): void {
  const message = assistant.querySelector('.chat-message');
  if (!message) {
    assistant.dataset.chatPreviewText = '';
    return;
  }
  const clone = message.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.tool-call-box, .chat-source-label, .chat-actions').forEach((element) => element.remove());
  assistant.dataset.chatPreviewText = collapseWhitespace(renderedElementToPlainText(clone));
}

function getAnchorOffset(anchor: HTMLElement, container: HTMLElement): number {
  const containerRect = container.getBoundingClientRect();
  return anchor.getBoundingClientRect().top - containerRect.top + container.scrollTop;
}

export function getMarkerHitIndex(positions: number[], pointerY: number, edgeTolerance = 4): number {
  if (!positions.length) return -1;
  if (pointerY < positions[0] - edgeTolerance || pointerY > positions[positions.length - 1] + edgeTolerance) return -1;
  let nearestIndex = 0;
  let nearestDistance = Math.abs(positions[0] - pointerY);
  for (let index = 1; index < positions.length; index++) {
    const distance = Math.abs(positions[index] - pointerY);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

export function createChatTurnNavigator(doc: Document, messageContainer: HTMLElement): ChatTurnNavigatorMount {
  const shell = doc.createElement('div');
  shell.classList.add('chat-turn-navigator-shell');

  const rail = doc.createElement('div');
  rail.classList.add('chat-turn-navigator');
  rail.tabIndex = 0;
  rail.setAttribute('role', 'navigation');
  rail.setAttribute('aria-label', getString('chat-turn-navigator-label' as any));

  const markersHost = doc.createElement('div');
  markersHost.classList.add('chat-turn-navigator-markers');
  rail.appendChild(markersHost);

  const preview = doc.createElement('div');
  preview.classList.add('chat-turn-navigator-preview');
  preview.hidden = true;
  preview.setAttribute('aria-live', 'polite');

  const userText = doc.createElement('div');
  userText.classList.add('chat-turn-navigator-preview-text', 'chat-turn-navigator-preview-user');
  const assistantText = doc.createElement('div');
  assistantText.classList.add('chat-turn-navigator-preview-text', 'chat-turn-navigator-preview-assistant');
  preview.append(userText, assistantText);
  rail.appendChild(preview);

  shell.append(rail, messageContainer);

  const view = doc.defaultView;
  let turns: ChatTurnNodes[] = [];
  let markerElements: HTMLElement[] = [];
  let markerPositions: number[] = [];
  let activeIndex = -1;
  let hoveredIndex: number | null = null;
  let pointerInside = false;
  let suppressedPointerIndex: number | null = null;
  let keyboardFocused = false;
  let scheduledFrame: number | undefined;
  let disposed = false;

  const reducedMotion = () => view?.matchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false;

  const getRootFontSize = () => {
    const root = doc.documentElement;
    if (!view || !root) return 16;
    const fontSize = view.getComputedStyle(root)?.fontSize;
    const parsed = Number.parseFloat(fontSize || '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
  };

  const updateMarkerAppearance = () => {
    rail.dataset.expanded = String(hoveredIndex !== null);
    markerElements.forEach((marker, index) => {
      marker.dataset.active = String(index === activeIndex);
      marker.dataset.hovered = String(index === hoveredIndex);
      marker.style.width = `${hoveredIndex === null ? 5 : getHoverMarkerWidth(index, hoveredIndex)}px`;
    });
  };

  const updatePreview = () => {
    if (hoveredIndex === null || !turns[hoveredIndex] || shell.dataset.navigatorVisible !== 'true') {
      preview.hidden = true;
      return;
    }

    userText.textContent = getUserPreview(turns[hoveredIndex]);
    assistantText.textContent = getAssistantPreview(turns[hoveredIndex]);
    preview.hidden = false;
    preview.style.width = `${Math.max(180, Math.min(360, shell.clientWidth - 54))}px`;

    const railHeight = rail.clientHeight;
    const previewHeight = preview.getBoundingClientRect().height;
    const desiredTop = (markerPositions[hoveredIndex] ?? railHeight / 2) - previewHeight / 2;
    preview.style.top = `${Math.max(8, Math.min(desiredTop, Math.max(8, railHeight - previewHeight - 8)))}px`;
  };

  const rebuildMarkers = () => {
    markersHost.replaceChildren();
    markerElements = turns.map((_turn, index) => {
      const marker = doc.createElement('span');
      marker.classList.add('chat-turn-navigator-marker');
      marker.setAttribute('aria-hidden', 'true');
      marker.title = getString('chat-turn-navigator-turn-label' as any, { args: { index: index + 1 } });
      markersHost.appendChild(marker);
      return marker;
    });
  };

  const refresh = () => {
    if (disposed) return;
    const nextTurns = getDirectTurnNodes(messageContainer);
    if (!elementsMatch(turns, nextTurns)) {
      turns = nextTurns;
      if (hoveredIndex !== null && hoveredIndex >= turns.length) hoveredIndex = turns.length ? turns.length - 1 : null;
      rebuildMarkers();
    } else {
      turns = nextTurns;
    }

    const hasRoom = shell.clientWidth >= CHAT_TURN_NAVIGATOR_MIN_WIDTH;
    shell.dataset.navigatorCompact = String(shouldUseCompactNavigator(shell.clientWidth, getRootFontSize()));
    const hasScrollableTurns = turns.length >= 2 && messageContainer.scrollHeight > messageContainer.clientHeight + 1;
    const visible = hasRoom && hasScrollableTurns;
    shell.dataset.navigatorVisible = String(visible);

    if (!visible) {
      hoveredIndex = null;
      preview.hidden = true;
      updateMarkerAppearance();
      return;
    }

    markerPositions = getCenteredMarkerPositions(turns.length, rail.clientHeight || shell.clientHeight);
    const maskBounds = getMarkerGroupMaskBounds(markerPositions, rail.clientHeight || shell.clientHeight);
    if (maskBounds) {
      rail.style.setProperty('--chat-turn-navigator-mask-top', `${maskBounds.top}px`);
      rail.style.setProperty('--chat-turn-navigator-mask-height', `${maskBounds.height}px`);
    }
    markerElements.forEach((marker, index) => {
      marker.style.top = `${markerPositions[index]}px`;
    });

    const anchorOffsets = turns.map((turn) => getAnchorOffset(turn.anchor, messageContainer));
    activeIndex = getActiveTurnIndex(anchorOffsets, messageContainer.scrollTop, messageContainer.clientHeight, messageContainer.scrollHeight);
    updateMarkerAppearance();
    updatePreview();
  };

  const scheduleRefresh = () => {
    if (disposed || scheduledFrame !== undefined) return;
    if (!view?.requestAnimationFrame) {
      refresh();
      return;
    }
    scheduledFrame = view.requestAnimationFrame(() => {
      scheduledFrame = undefined;
      refresh();
    });
  };

  const jumpToTurn = (index: number) => {
    const turn = turns[index];
    if (!turn) return;
    const top = Math.max(0, getAnchorOffset(turn.anchor, messageContainer) - 12);
    activeIndex = index;
    updateMarkerAppearance();
    messageContainer.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  const showIndex = (index: number) => {
    if (index < 0 || index >= turns.length) return;
    hoveredIndex = index;
    updateMarkerAppearance();
    updatePreview();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (shell.dataset.navigatorVisible !== 'true') return;
    pointerInside = true;
    const rect = rail.getBoundingClientRect();
    const targetIndex = getMarkerHitIndex(markerPositions, event.clientY - rect.top);
    if (targetIndex >= 0 && targetIndex === suppressedPointerIndex) return;
    if (targetIndex >= 0) suppressedPointerIndex = null;
    if (targetIndex >= 0) {
      showIndex(targetIndex);
    } else {
      hoveredIndex = null;
      updateMarkerAppearance();
      updatePreview();
    }
  };
  const onPointerLeave = () => {
    pointerInside = false;
    suppressedPointerIndex = null;
    if (keyboardFocused) return;
    hoveredIndex = null;
    updateMarkerAppearance();
    updatePreview();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || shell.dataset.navigatorVisible !== 'true') return;
    event.preventDefault();
    const rect = rail.getBoundingClientRect();
    const targetIndex = getMarkerHitIndex(markerPositions, event.clientY - rect.top);
    if (targetIndex < 0) return;
    jumpToTurn(targetIndex);
    suppressedPointerIndex = targetIndex;
    keyboardFocused = false;
    hoveredIndex = null;
    rail.blur();
    updateMarkerAppearance();
    updatePreview();
  };
  const onFocus = () => {
    keyboardFocused = true;
    if (suppressedPointerIndex !== null) return;
    showIndex(activeIndex >= 0 ? activeIndex : 0);
  };
  const onBlur = () => {
    keyboardFocused = false;
    if (pointerInside) return;
    hoveredIndex = null;
    updateMarkerAppearance();
    updatePreview();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!turns.length) return;
    suppressedPointerIndex = null;
    let nextIndex = hoveredIndex ?? Math.max(0, activeIndex);
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = Math.max(0, nextIndex - 1);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = Math.min(turns.length - 1, nextIndex + 1);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = turns.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      jumpToTurn(nextIndex);
      return;
    } else {
      return;
    }
    event.preventDefault();
    showIndex(nextIndex);
  };

  rail.addEventListener('pointermove', onPointerMove);
  rail.addEventListener('pointerleave', onPointerLeave);
  rail.addEventListener('pointerdown', onPointerDown);
  rail.addEventListener('focus', onFocus);
  rail.addEventListener('blur', onBlur);
  rail.addEventListener('keydown', onKeyDown);
  messageContainer.addEventListener('scroll', scheduleRefresh, { passive: true });

  const MutationObserverCtor = view?.MutationObserver;
  const structureObserver = MutationObserverCtor ? new MutationObserverCtor(scheduleRefresh) : undefined;
  structureObserver?.observe(messageContainer, {
    childList: true,
  });
  const previewObserver = MutationObserverCtor ? new MutationObserverCtor(scheduleRefresh) : undefined;
  previewObserver?.observe(messageContainer, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-chat-role', 'data-chat-preview-text'],
  });

  const ResizeObserverCtor = (view as any)?.ResizeObserver as typeof ResizeObserver | undefined;
  const resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(scheduleRefresh) : undefined;
  resizeObserver?.observe(shell);
  resizeObserver?.observe(messageContainer);
  if (!resizeObserver) view?.addEventListener('resize', scheduleRefresh);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    structureObserver?.disconnect();
    previewObserver?.disconnect();
    resizeObserver?.disconnect();
    if (!resizeObserver) view?.removeEventListener('resize', scheduleRefresh);
    rail.removeEventListener('pointermove', onPointerMove);
    rail.removeEventListener('pointerleave', onPointerLeave);
    rail.removeEventListener('pointerdown', onPointerDown);
    rail.removeEventListener('focus', onFocus);
    rail.removeEventListener('blur', onBlur);
    rail.removeEventListener('keydown', onKeyDown);
    messageContainer.removeEventListener('scroll', scheduleRefresh);
    if (scheduledFrame !== undefined) view?.cancelAnimationFrame(scheduledFrame);
    scheduledFrame = undefined;
  };

  refresh();
  return { shell, refresh, dispose };
}

export function setChatTurnNavigatorHost(host: HTMLElement, dispose: () => void): void {
  (host as ChatTurnNavigatorHost)._disposeTurnNavigator = dispose;
}

export function disposeChatTurnNavigatorHost(host: Element | null | undefined): void {
  const typedHost = host as ChatTurnNavigatorHost | undefined;
  typedHost?._disposeTurnNavigator?.();
  if (typedHost) delete typedHost._disposeTurnNavigator;
}

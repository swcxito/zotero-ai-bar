/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * chatUI.ts
 *
 * This file is part of Zotero AI Bar.
 * Zotero AI Bar - A handy AI assistant integration for Zotero
 *
 * Copyright (c) 2026. swcxito <120201848+swcxito@users.noreply.github.com>
 *
 * Zotero AI Bar is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * Zotero AI Bar is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
 *
 * Repository: https://github.com/swcxito/zotero-ai-bar
 */

import { ChatBox } from '../components/chatBox';
import { ToolCallBox, updateToolCallBox } from '../components/toolCallBox';
import { escapeHtml, renderMarkdown } from '../utils/markdown';
import { ensureChatWindow } from '../utils/window';
import { CHAT_WINDOW_MESSAGE_CONTAINER_ID, ensureChatWindowUI } from './chatWindowHost';
import { resizeReaderItemPaneHeight, scrollToBottom, setSendBtnEnabled } from './readerItemPane';
import type { Session, TokenUsage } from './chatManager';
import { IconView } from '../components/iconView';
import { Icons } from '../components/common';
import { getString } from '../utils/locale';
import { createImageViewer } from '../components/imagePreview';
import { getReaderByTabId } from './tabObserver';
import { buildErrorMessage } from './llm';
import { getActiveModelContextLimit } from '../utils/providers';
import { openCitation } from './citationAction';
import { getItemFullTextByPage } from '../utils/zoteroItemAccess';
import { normalizePartOfSpeech, type TranslationResult } from '../utils/translation';

Zotero.debug('[zaibar-chatUI] module loaded');

/**
 * Wire click handlers to any `.zaibar-cite` spans inside `root`.
 * Safe to call repeatedly on the same root — already-bound spans are
 * skipped via a `data-bound` flag.
 */
export function attachCitationHandlers(root: HTMLElement): void {
  const spans = root.querySelectorAll<HTMLElement>('.zaibar-cite:not([data-bound])');
  for (const span of spans) {
    span.setAttribute('data-bound', '1');
    span.addEventListener('click', () => {
      const itemId = parseInt(span.getAttribute('data-item-id') || '', 10);
      if (!Number.isFinite(itemId)) return;
      const lineStr = span.getAttribute('data-line');
      const pageStr = span.getAttribute('data-page');
      if (lineStr) {
        // Line cite: resolve 1-based line -> page via the item's lineToPage
        // map, then open. Falls back to no page if resolution fails.
        const line = parseInt(lineStr, 10);
        void resolveLineToPage(itemId, line).then((page) => openCitation(itemId, page));
      } else {
        const page = pageStr ? parseInt(pageStr, 10) : undefined;
        void openCitation(itemId, page);
      }
    });
    attachCitationTooltip(span);
  }
}

/**
 * Resolve a 1-based document line number to its 1-based PDF page number using
 * the item's precomputed `lineToPage` map. Returns `undefined` if the line is
 * out of range or the full text is unavailable.
 */
async function resolveLineToPage(itemId: number, line: number): Promise<number | undefined> {
  try {
    const pageResult = await getItemFullTextByPage(itemId);
    if (!pageResult) return undefined;
    // lineToPage maps 0-based line index -> 1-based page number.
    return pageResult.lineToPage.get(line - 1);
  } catch {
    return undefined;
  }
}

/**
 * Lazily render a fade-in metadata tooltip on hover. The tooltip is built
 * on first mouseenter (so we don't pay the cost for every citation when
 * streaming) and removed on mouseleave. Position is fixed-viewport
 * anchored above/below the pill with horizontal flip if it would overflow.
 *
 * Styles are applied inline (not via class) because the sidebar chat lives
 * inside a Shadow DOM whose CSS does not leak to `doc.body`, where the
 * tooltip is appended to escape overflow clipping.
 */
function attachCitationTooltip(span: HTMLElement): void {
  const doc = span.ownerDocument!;
  let tooltip: HTMLElement | null = null;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;

  const applyBaseStyles = (tip: HTMLElement, dark: boolean) => {
    tip.style.position = 'fixed';
    tip.style.zIndex = '2147483647';
    tip.style.maxWidth = '360px';
    tip.style.minWidth = '200px';
    tip.style.padding = '8px 10px';
    tip.style.borderRadius = '8px';
    tip.style.boxShadow = dark ? '0 4px 16px rgba(0,0,0,0.5)' : '0 4px 16px rgba(0,0,0,0.18)';
    tip.style.border = dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e5e7eb';
    tip.style.backgroundColor = dark ? 'rgba(45,45,48,0.98)' : '#ffffff';
    tip.style.color = dark ? '#f3f4f6' : '#1f2937';
    tip.style.fontFamily = 'inherit';
    tip.style.fontSize = '12px';
    tip.style.lineHeight = '1.45';
    tip.style.fontWeight = '400';
    tip.style.fontStyle = 'normal';
    tip.style.whiteSpace = 'normal';
    tip.style.wordBreak = 'break-word';
    tip.style.pointerEvents = 'none';
    tip.style.opacity = '0';
    tip.style.transition = 'opacity 160ms ease-out';
  };

  const buildTooltip = (): HTMLElement | null => {
    const itemId = parseInt(span.getAttribute('data-item-id') || '', 10);
    const page = span.getAttribute('data-page');
    const rangeText = span.getAttribute('data-page-range');
    const line = span.getAttribute('data-line');
    const lineRangeText = span.getAttribute('data-line-range');
    const info = buildCitationMetadata(itemId);
    const dark = doc.defaultView?.matchMedia('(prefers-color-scheme: dark)')?.matches ?? false;
    const secondary = dark ? '#cbd5e1' : '#6b7280';
    const tertiary = dark ? '#9ca3af' : '#4b5563';

    const tip = doc.createElement('div');
    applyBaseStyles(tip, dark);

    // Header cards already display the full title prominently - skip the
    // title row in the tooltip so it shows only the supplementary info
    // (journal, authors, page) the user doesn't already see.
    const isHeader = span.classList.contains('zaibar-cite-header');

    if (info.title && !isHeader) {
      const titleEl = doc.createElement('div');
      titleEl.textContent = info.title;
      titleEl.style.fontWeight = '600';
      titleEl.style.marginBottom = '4px';
      tip.appendChild(titleEl);
    }
    if (info.journal) {
      const journalEl = doc.createElement('div');
      journalEl.textContent = info.journal;
      journalEl.style.fontStyle = 'italic';
      journalEl.style.color = secondary;
      journalEl.style.marginBottom = '4px';
      tip.appendChild(journalEl);
    }
    if (info.authors) {
      const authorsEl = doc.createElement('div');
      authorsEl.textContent = info.authors;
      authorsEl.style.color = tertiary;
      tip.appendChild(authorsEl);
    }
    if (page) {
      const pageEl = doc.createElement('div');
      // Range (e.g. "5-12") shows "p.5-12"; single page shows "p.<page>".
      // Single `p.` prefix for both - the range conveys multipage on its own.
      pageEl.textContent = rangeText ? `p.${rangeText}` : `p.${page}`;
      pageEl.style.marginTop = '4px';
      pageEl.style.color = secondary;
      pageEl.style.fontSize = '11px';
      tip.appendChild(pageEl);
    }
    if (line) {
      const lineEl = doc.createElement('div');
      lineEl.textContent = lineRangeText ? `L.${lineRangeText}` : `L.${line}`;
      lineEl.style.marginTop = '4px';
      lineEl.style.color = secondary;
      lineEl.style.fontSize = '11px';
      tip.appendChild(lineEl);
    }

    // Nothing meaningful to show - caller will skip rendering.
    if (!tip.children.length) return null;

    return tip;
  };

  const positionTooltip = (tip: HTMLElement) => {
    const spanRect = span.getBoundingClientRect();
    const view = doc.defaultView;
    const vw = view?.innerWidth ?? spanRect.right + 200;
    const vh = view?.innerHeight ?? 800;
    const GAP = 6;
    const isHeader = span.classList.contains('zaibar-cite-header');

    // Header cards prefer below (so the tooltip extends section-info
    // downward, not over the previous paragraph). Inline pills prefer above
    // (so the tooltip doesn't cover the next line of text the user is
    // reading). Either preference flips when near the corresponding edge.
    let placeBelow = isHeader;
    if (placeBelow && spanRect.bottom > vh - 160) placeBelow = false;
    else if (!placeBelow && spanRect.top < 120) placeBelow = true;

    // Anchor: centered horizontally on the span.
    tip.style.left = `${spanRect.left + spanRect.width / 2}px`;
    if (placeBelow) {
      tip.style.top = `${spanRect.bottom + GAP}px`;
      tip.style.transform = 'translateX(-50%) translateY(0)';
    } else {
      tip.style.top = `${spanRect.top - GAP}px`;
      tip.style.transform = 'translateX(-50%) translateY(-100%)';
    }

    // Horizontal flip / clamp if the centered tooltip would overflow.
    const tipRect = tip.getBoundingClientRect();
    const verticalOnly = placeBelow ? 'translateY(0)' : 'translateY(-100%)';
    if (tipRect.left < 8) {
      tip.style.left = `${Math.max(8, spanRect.left)}px`;
      tip.style.transform = verticalOnly;
    } else if (tipRect.right > vw - 8) {
      tip.style.left = `${Math.min(vw - 8, spanRect.right)}px`;
      tip.style.transform = `${verticalOnly} translateX(-100%)`;
    }
  };

  const show = () => {
    if (hideTimer !== undefined) {
      doc.defaultView?.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
    if (showTimer !== undefined) return;
    showTimer = doc.defaultView?.setTimeout(() => {
      showTimer = undefined;
      if (tooltip) return;
      const built = buildTooltip();
      if (!built) return;
      tooltip = built;
      // Mount on the pill itself. position:fixed takes the tooltip out of
      // flow, so the pill's inline-flex layout and overflow:hidden
      // (text-ellipsis) are unaffected, and the tooltip is not clipped by
      // them. This also keeps the tooltip in the same document context as
      // the span, avoiding the XUL-document (no <body>) problem.
      span.appendChild(tooltip);
      positionTooltip(tooltip);
      // Trigger fade-in on the next frame.
      doc.defaultView?.requestAnimationFrame(() => {
        if (!tooltip) return;
        tooltip.style.opacity = '1';
      });
    }, 180);
  };

  const hide = () => {
    if (showTimer !== undefined) {
      doc.defaultView?.clearTimeout(showTimer);
      showTimer = undefined;
    }
    if (!tooltip) return;
    const el = tooltip;
    tooltip = null;
    el.style.opacity = '0';
    hideTimer = doc.defaultView?.setTimeout(() => {
      el.remove();
    }, 180);
  };

  span.addEventListener('mouseenter', show);
  span.addEventListener('mouseleave', hide);
  // Hide when the user clicks (the reader will open, the pill may scroll away).
  span.addEventListener('click', hide);
}

interface CitationMetadata {
  title: string;
  journal: string;
  authors: string;
}

function buildCitationMetadata(itemId: number): CitationMetadata {
  const empty = { title: '', journal: '', authors: '' };
  try {
    const item = Zotero.Items.get(itemId);
    if (!item) return empty;
    // If the AI cited an attachment ID, pull metadata from the parent item.
    let meta: Zotero.Item = item;
    if (item.isAttachment?.()) {
      const parentID = (item as any).parentItemID ?? (item as any).parentID;
      if (parentID) {
        const parent = Zotero.Items.get(parentID);
        if (parent) meta = parent;
      }
    }
    const title = (meta.getField?.('title') as string | undefined)?.trim() ?? '';
    const journal = (meta.getField?.('publicationTitle') as string | undefined)?.trim() ?? '';
    let authors = '';
    try {
      const creators = (meta.getCreators?.() as Array<{ lastName?: string; firstName?: string; name?: string }>) ?? [];
      authors = creators
        .map((c) => (c.name?.trim() || [c.lastName, c.firstName].filter(Boolean).join(' ').trim() || '').trim())
        .filter((n) => n.length > 0)
        .join(', ');
    } catch {
      // ignore
    }
    return { title, journal, authors };
  } catch {
    return empty;
  }
}

export function onLLMStreamStartV2(session: Session) {
  ztoolkit.log('LLM stream started:', session.id);

  updateSectionInputArea(session.id, true);
  // Reset all auto-scroll state for the new turn.
  session.pending.shouldAutoScroll = true;
  session.pending.scrollUserPaused = false;
  session.pending.scrollLengthPaused = false;
  session.pending.scrollUserOverride = false;
  session.pending.inToolPhase = false;
  session.pending.currentTextSegment = null;
  const container = getMessageContainer(session);
  if (!container) return;
  bindAutoScrollTracker(container, session);

  const doc = container.ownerDocument;
  if (!doc) return;

  // Disable the Retry button on the previous assistant bubble - once a new
  // turn starts, prior replies are no longer retryable. Only the latest is.
  const prevPop = session.lastAssistantPop;
  if (prevPop && prevPop.isConnected) {
    const prevRetry = prevPop.querySelector('.retry-action') as HTMLButtonElement | null;
    if (prevRetry) {
      prevRetry.disabled = true;
      prevRetry.style.opacity = '0.4';
      // HTML `disabled` only blocks clicks, not CSS :hover - so the
      // hover:border/bg/text + transition-all from BUTTON_VARIANTS.action
      // would still animate on mouseover. pointer-events:none stops the
      // button from receiving hover at all, keeping the dimmed state static.
      prevRetry.style.pointerEvents = 'none';
    }
  }

  const pop = ChatBox({
    doc,
    isUser: false,
    onRegenerate: () => addon.chatManager.regenerateLastResponse(session),
  }) as HTMLElement;
  // pop.setAttribute("data-request-id", data.requestId);

  const chatMessage = pop.querySelector('.chat-message') as HTMLElement | null;
  if (chatMessage) {
    const sourceLabel = session.sourceLabel;
    const shouldShowSourceLabel = !!sourceLabel && !!session.pending.isNewSource;

    if (sourceLabel) {
      pop.dataset.sourceLabel = sourceLabel;
    }

    if (shouldShowSourceLabel) {
      const sourceEl = doc.createElement('div');
      sourceEl.classList.add('chat-source-label', 'text-xs', 'tracking-wider', 'font-semibold', 'text-slate-400', 'dark:text-neutral-500', 'mb-1');
      sourceEl.textContent = `Source: ${sourceLabel}`;
      sourceEl.style.userSelect = 'none';
      chatMessage.appendChild(sourceEl);
    }

    const contentEl = doc.createElement('div');
    contentEl.classList.add('chat-message-content');
    chatMessage.appendChild(contentEl);
    // Non-agent path: the single content element is the active text segment.
    session.pending.currentTextSegment = contentEl;
  }

  container.appendChild(pop);
  session.pending.messagePop = pop;
  // Track the latest assistant bubble for Retry (disable on next turn, locate
  // for removal on retry).
  session.lastAssistantPop = pop as HTMLElement;
  maybeAutoScroll(session);
}

export async function onLLMStreamUpdateV2(data: { session: Session; fullText: string; force?: boolean }) {
  const pop = data.session.pending.messagePop;
  if (!pop) return;

  let chatMessage = pop.querySelector('.chat-message-content') as HTMLElement | null;
  // onReasoningStartV2 removes empty .chat-message-content placeholders to
  // keep the reasoning card in stream order. After reasoning ends, the first
  // text-delta arrives but the content div is gone — recreate it so the final
  // answer actually renders instead of being silently dropped.
  if (!chatMessage) {
    const messageEl = pop.querySelector('.chat-message') as HTMLElement | null;
    if (!messageEl) return;
    chatMessage = data.session.pending.currentTextSegment as HTMLElement | null;
    if (!chatMessage || !chatMessage.isConnected) {
      chatMessage = messageEl.ownerDocument!.createElement('div');
      chatMessage.classList.add('chat-message-content');
      messageEl.appendChild(chatMessage);
    }
    data.session.pending.currentTextSegment = chatMessage;
  }

  const newLen = data.fullText.length;
  const prevLen = data.session.pending.lastRenderedLength ?? 0;
  if (!data.force && newLen - prevLen < 20 && prevLen > 0) return;

  chatMessage.innerHTML = await renderMarkdown(data.fullText, data.session.itemId);
  attachCitationHandlers(chatMessage as HTMLElement);
  (pop as HTMLElement).dataset.markdown = data.fullText;
  data.session.pending.lastRenderedLength = newLen;
  // Non-agent path: keep the active text segment ref in sync (innerHTML rewrite
  // doesn't replace the element, but be safe).
  data.session.pending.currentTextSegment = chatMessage as HTMLElement;

  maybeAutoScroll(data.session);
}

/**
 * Geometric stop condition: when the AI bubble's top scrolls out of the
 * container's top, stop auto-scroll (so a very long AI reply doesn't push
 * itself off-screen while the user reads the start). Two escape hatches keep
 * this from re-disabling auto-scroll between agent tool calls:
 *  1. During programmatic smooth-scroll animation the position is transient —
 *     skip the check (the mark is set by followToBottom).
 *  2. If the user is parked at the bottom, respect the explicit "follow"
 *     intent and keep scrolling.
 */
/**
 * Programmatic scrollToBottom wrapper. Marks a short window during which the
 * scroll listener ignores position changes — otherwise the smooth-scroll
 * animation (scrollTop lagging behind the newly-grown scrollHeight) would
 * transiently look "not near bottom" and flip the user-pause flags.
 */
function followToBottom(container: HTMLElement) {
  const host = container as HTMLElement & { __markProgrammaticScroll?: () => void };
  host.__markProgrammaticScroll?.();
  scrollToBottom(container);
}

/**
 * Unified auto-scroll decision. Rules (highest priority first):
 *  1. User scrolled up (scrollUserPaused) → never scroll.
 *  2. Tool phase (inToolPhase) → always follow to bottom.
 *  3. Final-answer text phase:
 *     - If the active text segment, when scrolled to bottom, would have its
 *       top at ≤6px from the viewport top (i.e. content from seg-top to
 *       scroll-bottom ≥ viewport height − 6), AND the user hasn't explicitly
 *       overridden by scrolling to bottom → set scrollLengthPaused, stop.
 *     - Otherwise → follow to bottom.
 * `shouldAutoScroll` is the user-intent master flag (set on stream start,
 * cleared on user-scroll-up, re-set on user-scroll-to-bottom).
 */
function maybeAutoScroll(session: Session) {
  const pop = session.pending.messagePop as HTMLElement | undefined;
  const container = pop?.parentElement as HTMLElement | undefined;
  if (!pop || !container) return;
  // Rule 1: user paused (highest priority).
  if (session.pending.scrollUserPaused) return;
  if (!session.pending.shouldAutoScroll) return;
  // Rule 2: tool phase always follows.
  if (session.pending.inToolPhase) {
    followToBottom(container);
    return;
  }
  // Rule 3: final-answer text phase.
  const seg = session.pending.currentTextSegment;
  if (seg && !session.pending.scrollUserOverride) {
    // Projected seg-top distance from viewport top when scrolled to bottom:
    //   clientHeight - (scrollHeight - segTopAbsolute)
    // If ≤ 6 → the segment fills the viewport → stop.
    const containerTop = container.getBoundingClientRect().top;
    const segTopAbsolute = seg.getBoundingClientRect().top - containerTop + container.scrollTop;
    const contentFromSegTopToBottom = container.scrollHeight - segTopAbsolute;
    if (contentFromSegTopToBottom >= container.clientHeight - 6) {
      session.pending.scrollLengthPaused = true;
      return;
    }
  }
  // User overrode (scrollUserOverride) → always follow, bypass 6px.
  session.pending.scrollLengthPaused = false;
  followToBottom(container);
}

/**
 * Track user scroll intent. Binds once per container; re-binds just refresh
 * the active session id (window mode reuses one container across items).
 *  - user scrolls up (wheel/touch/scrollbar) → scrollUserPaused=true (stop)
 *  - user scrolls back to bottom → clear pauses, set override (follow)
 * Programmatic scrollToBottom is suppressed via __markProgrammaticScroll.
 */
function bindAutoScrollTracker(container: HTMLElement, session: Session) {
  const host = container as HTMLElement & {
    __autoScrollBound?: boolean;
    __autoScrollSessionId?: string;
    __programmaticScrollUntil?: number;
    __markProgrammaticScroll?: () => void;
  };
  host.__autoScrollSessionId = session.id;
  if (host.__autoScrollBound) return;
  host.__autoScrollBound = true;

  const BOTTOM_THRESHOLD = 16;
  const PROGRAMMATIC_GRACE_MS = 600;
  const getSession = (): Session | undefined => {
    const id = host.__autoScrollSessionId;
    return id ? addon.chatManager.sessionsMap.get(id) : undefined;
  };
  const isNearBottom = () => {
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight <= BOTTOM_THRESHOLD;
  };
  const isProgrammatic = () => (host.__programmaticScrollUntil ?? 0) > Date.now();
  host.__markProgrammaticScroll = () => {
    host.__programmaticScrollUntil = Date.now() + PROGRAMMATIC_GRACE_MS;
  };

  // User scrolled up — highest priority pause.
  const userScrollUp = (s: Session) => {
    s.pending.scrollUserPaused = true;
    s.pending.scrollUserOverride = false;
    s.pending.shouldAutoScroll = false;
  };
  // User scrolled to bottom. Two cases:
  //  - If currently length-paused (final answer exceeded viewport): set
  //    scrollUserOverride so this segment keeps following to the bottom,
  //    bypassing the 6px rule until the user scrolls up again or a new
  //    final-answer segment starts.
  //  - Otherwise (still within viewport / tool phase): just clear the
  //    user-pause and let the normal rules apply. Setting override here
  //    would wrongly disable the 6px stop for the rest of the reply.
  const userScrollToBottom = (s: Session) => {
    s.pending.scrollUserPaused = false;
    s.pending.shouldAutoScroll = true;
    if (s.pending.scrollLengthPaused) {
      s.pending.scrollLengthPaused = false;
      s.pending.scrollUserOverride = true;
    }
    maybeAutoScroll(s);
  };

  // Scroll listener catches scrollbar drag and keyboard paging. Suppressed
  // during programmatic smooth-scroll animation.
  const onScroll = () => {
    if (isProgrammatic()) return;
    const s = getSession();
    if (!s) return;
    if (isNearBottom()) userScrollToBottom(s);
    else userScrollUp(s);
  };

  const onWheel = (e: WheelEvent) => {
    const s = getSession();
    if (!s) return;
    if (e.deltaY < 0) {
      userScrollUp(s);
    } else if (e.deltaY > 0 && isNearBottom()) {
      userScrollToBottom(s);
    }
  };

  let lastTouchY: number | null = null;
  const onTouchMove = (e: TouchEvent) => {
    const s = getSession();
    if (!s) return;
    const t = e.touches[0];
    if (!t) return;
    const prev = lastTouchY;
    lastTouchY = t.clientY;
    if (prev == null) return;
    const delta = t.clientY - prev; // finger down (positive) → content scrolls up → away from bottom
    if (delta > 0) {
      userScrollUp(s);
    } else if (delta < 0 && isNearBottom()) {
      userScrollToBottom(s);
    }
  };
  const onTouchEnd = () => {
    lastTouchY = null;
  };

  container.addEventListener('scroll', onScroll, { passive: true });
  container.addEventListener('wheel', onWheel, { passive: true });
  container.addEventListener('touchmove', onTouchMove, { passive: true });
  container.addEventListener('touchend', onTouchEnd, { passive: true });
}

export function onLLMStreamEndV2(session: Session, usage?: TokenUsage, aborted?: boolean) {
  const pop = session.pending.messagePop;
  if (pop) {
    const actions = pop.querySelector('.chat-actions');
    if (actions) {
      actions.classList.remove('hidden');
      appendUsageBadge(actions as HTMLElement, usage);
      maybeAutoScroll(session);
    }

    // Auto-copy to clipboard if flag is set
    if (session.pending.shouldCopyResponse) {
      const markdown = (pop as HTMLElement).dataset.markdown;
      if (markdown) {
        try {
          new ztoolkit.Clipboard().addText(markdown, 'text/plain').copy();
          ztoolkit.log('Auto-copied markdown to clipboard');
        } catch (e) {
          ztoolkit.log('Auto-copy failed:', e);
        }
      }
    }

    // Append turn to conversation history (sidebar mode).
    // In agent mode the history is managed by consumeAgentStream using the
    // SDK's response.messages, so skip the simple text-only append here.
    // Aborted (stopped/superseded) non-agent turns are also skipped so a
    // partial reply isn't recorded - consistent with the agent path's guard.
    if (!session.pending.isAgentMode && !aborted) {
      const userMessage = session.pending.userMessage;
      const assistantContent = (pop as HTMLElement).dataset.markdown || '';
      if (userMessage) {
        session.conversationHistory.push(userMessage);
      }
      if (assistantContent) {
        session.conversationHistory.push({
          role: 'assistant',
          content: assistantContent,
        });
      }
    }
  }
  updateSectionInputArea(session.id, false);
  cleanupRequestData(session);
  if (usage) {
    session.lastUsage = normalizeUsage(usage);
    updateContextTokenIndicator(session.id, session.lastUsage);
  }
}

function normalizeUsage(raw: any): TokenUsage {
  if (!raw || typeof raw !== 'object') return {};
  const promptTokens = typeof raw.inputTokens === 'number' ? raw.inputTokens : typeof raw.promptTokens === 'number' ? raw.promptTokens : undefined;
  const completionTokens =
    typeof raw.outputTokens === 'number' ? raw.outputTokens : typeof raw.completionTokens === 'number' ? raw.completionTokens : undefined;
  const totalTokens =
    typeof raw.totalTokens === 'number'
      ? raw.totalTokens
      : promptTokens !== undefined && completionTokens !== undefined
        ? promptTokens + completionTokens
        : undefined;
  return { promptTokens, completionTokens, totalTokens };
}

function formatTokenCount(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 100000) return (n / 1000).toFixed(1) + 'K';
  if (n < 1000000) return Math.round(n / 1000) + 'K';
  return (n / 1000000).toFixed(1) + 'M';
}

function appendUsageBadge(actions: HTMLElement, usage: any): void {
  const normalized = normalizeUsage(usage);
  const hasAny = normalized.promptTokens !== undefined || normalized.completionTokens !== undefined || normalized.totalTokens !== undefined;
  if (!hasAny) return;
  const doc = actions.ownerDocument!;
  const existing = actions.querySelector('.chat-token-usage');
  if (existing) existing.remove();
  const badge = doc.createElement('span');
  badge.classList.add(
    'chat-token-usage',
    'ml-auto',
    'text-xs',
    'font-medium',
    'px-2',
    'py-0.5',
    'rounded-md',
    'bg-slate-200/80',
    'text-slate-700',
    'dark:bg-zinc-700/80',
    'dark:text-zinc-200',
    'select-none',
    'whitespace-nowrap'
  );
  const promptStr = formatTokenCount(normalized.promptTokens);
  const compStr = formatTokenCount(normalized.completionTokens);
  badge.textContent = `↑${promptStr} ↓${compStr}`;
  const titleParts: string[] = [];
  if (normalized.promptTokens !== undefined) titleParts.push(`${getString('token-usage-input')}: ${normalized.promptTokens.toLocaleString()}`);
  if (normalized.completionTokens !== undefined)
    titleParts.push(`${getString('token-usage-output')}: ${normalized.completionTokens.toLocaleString()}`);
  if (normalized.totalTokens !== undefined) titleParts.push(`${getString('token-usage-total')}: ${normalized.totalTokens.toLocaleString()}`);
  badge.title = titleParts.join(' · ');
  actions.appendChild(badge);
}

function updateContextTokenIndicator(sessionId: string, usage: TokenUsage): void {
  let indicator: HTMLElement | null = null;
  const body = addon.data.sidePaneBodyMap?.get(sessionId);
  if (body) {
    const root = body.querySelector('#ai-bar-chat-root');
    if (root?.shadowRoot) {
      indicator = root.shadowRoot.querySelector('.input-context-tokens') as HTMLElement | null;
    }
  }
  if (!indicator && addon.chatManager.getCurrentHostMode() === 'window') {
    try {
      const chatWindow = ensureChatWindow();
      indicator = chatWindow.document.querySelector('.input-context-tokens') as HTMLElement | null;
    } catch (e) {
      // window not ready — skip
    }
  }
  if (!indicator) return;
  // Total context = previous turn's input + output (what the next request would carry).
  const contextTokens = usage.totalTokens ?? usage.promptTokens;
  const contextLimit = getActiveModelContextLimit();
  const ctxStr = formatTokenCount(contextTokens);
  let text: string;
  if (contextLimit && contextLimit > 0 && contextTokens !== undefined) {
    const pct = Math.min(100, (contextTokens / contextLimit) * 100);
    const pctStr = pct < 1 ? pct.toFixed(1) : Math.round(pct).toString();
    text = `${getString('token-usage-context')}: ${ctxStr} / ${formatTokenCount(contextLimit)} · ${pctStr}%`;
  } else if (contextTokens !== undefined) {
    text = `${getString('token-usage-context')}: ${ctxStr}`;
  } else {
    text = `${getString('token-usage-context')}: —`;
  }
  indicator.textContent = text;
  indicator.title = contextLimit
    ? `${getString('token-usage-context-window')}: ${contextLimit.toLocaleString()}`
    : getString('token-usage-context-window-unknown');
}

export function onLLMStreamErrorV2(data: { session: Session; error: string }) {
  ztoolkit.log('LLM stream error:', data.session.id, data.error);
  let pop = data.session.pending.messagePop;

  // If no message pop exists yet (error during init), create one
  if (!pop) {
    const container = getMessageContainer(data.session);
    if (container) {
      const doc = container.ownerDocument;
      pop = ChatBox({ doc, isUser: false }) as HTMLElement;
      const chatMsg = pop.querySelector('.chat-message') as HTMLElement | null;
      if (chatMsg) {
        const contentEl = doc.createElement('div');
        contentEl.classList.add('chat-message-content');
        chatMsg.appendChild(contentEl);
      }
      container.appendChild(pop);
      data.session.pending.messagePop = pop;
    }
  }

  if (pop) {
    const actions = pop.querySelector('.chat-actions');
    if (actions) {
      actions.classList.remove('hidden');
    }
    const chatMessage = pop.querySelector('.chat-message-content');
    if (chatMessage) {
      chatMessage.innerHTML = `<div class="ai-bar-error-text">${escapeHtml(data.error)}</div>`;
    } else {
      const chatMsg = pop.querySelector('.chat-message') as HTMLElement | null;
      if (chatMsg) {
        chatMsg.innerHTML = `<div class="ai-bar-error-text">${escapeHtml(data.error)}</div>`;
      }
    }
    maybeAutoScroll(data.session);
  }
  // Clear streaming state
  updateSectionInputArea(data.session.id, false);
  cleanupRequestData(data.session);
}

function cleanupRequestData(session: Session) {
  session.pending = {};
}

function getMessageContainer(session: Session): HTMLElement | null {
  if (addon.chatManager.getCurrentHostMode() === 'window') {
    const chatWindow = ensureChatWindow();
    ensureChatWindowUI(chatWindow.document);
    return chatWindow.document.querySelector(`#${CHAT_WINDOW_MESSAGE_CONTAINER_ID}`) as HTMLElement | null;
  }

  if (!addon.data.sidePaneBodyMap) return null;
  const sectionId = session.id ?? addon.chatManager.currentTabID;
  if (sectionId === undefined) return null;
  const body = addon.data.sidePaneBodyMap.get(sectionId);
  if (!body) return null;
  const root = body.querySelector('#ai-bar-chat-root');
  if (!root?.shadowRoot) return null;

  resizeReaderItemPaneHeight(body, 'maximize');
  return root.shadowRoot.querySelector('.message-container') as HTMLElement;
}

/**
 * Update the send/stop button in the inputArea inside a section's shadow DOM.
 * Called after isStreaming changes so the UI reflects current state.
 */
function updateSectionInputArea(sessionId: string, isStreaming: boolean) {
  const body = addon.data.sidePaneBodyMap?.get(sessionId);
  if (!body) return;
  const root = body.querySelector('#ai-bar-chat-root');
  if (!root?.shadowRoot) return;
  const shadowRoot = root.shadowRoot;

  const inputArea = shadowRoot.querySelector('.input-area');
  if (!inputArea) return;

  const doc = body.ownerDocument;
  const textarea = inputArea.querySelector('textarea') as HTMLTextAreaElement | null;
  const hasText = (textarea?.value?.trim()?.length ?? 0) > 0;

  const sendBtn = inputArea.querySelector('.input-send-btn') as HTMLButtonElement | null;
  if (!sendBtn) return;

  if (isStreaming) {
    sendBtn.dataset.mode = 'stop';
    setSendBtnEnabled(sendBtn, true);
    sendBtn.innerHTML = '';
    sendBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Stop, sizeRem: 1.5, extraClasses: ['text-white'] })));
  } else {
    sendBtn.dataset.mode = 'send';
    setSendBtnEnabled(sendBtn, hasText);
    sendBtn.innerHTML = '';
    sendBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Send, sizeRem: 1.5, extraClasses: ['text-white'] })));
  }
}

export function onToolCallStartV2(session: Session, toolCall: any) {
  Zotero.debug('[zaibar-chatui] onToolCallStartV2 ' + toolCall.toolName);
  const pop = session.pending.messagePop;
  if (!pop) return;
  const chatMessage = pop.querySelector('.chat-message') as HTMLElement | null;
  if (!chatMessage) return;

  const box = ToolCallBox({
    doc: pop.ownerDocument!,
    toolName: toolCall.toolName,
    summary: getString('tool-call-status-running'),
    details: JSON.stringify(toolCall.input ?? toolCall.args, null, 2),
    isExpanded: toolCall.toolName === 'capture_page',
  });
  chatMessage.appendChild(box);
  session.pending.toolCallBoxes = session.pending.toolCallBoxes || new Map();
  session.pending.toolCallBoxes.set(toolCall.toolCallId, box);

  maybeAutoScroll(session);
}

export function onToolCallEndV2(session: Session, toolResult: any) {
  Zotero.debug('[zaibar-chatui] onToolCallEndV2 ' + toolResult.toolName);
  const box = session.pending.toolCallBoxes?.get(toolResult.toolCallId);
  if (!box) return;

  const output = toolResult.output ?? toolResult.result;
  const hasError = output && typeof output === 'object' && 'error' in output;

  if (toolResult.toolName === 'ask_user' && Array.isArray(output)) {
    const parts: string[] = [];
    const detailLines: string[] = [];
    for (let i = 0; i < output.length; i++) {
      const a = output[i];
      const selected = a.selectedOptions?.join(', ') || '(none)';
      const custom = a.customInput ? ` [+ "${a.customInput}"]` : '';
      parts.push(`${selected}${custom}`);
      detailLines.push(`Q: ${a.question}\n  → ${selected}${custom}`);
    }
    const summary = parts.join('; ');
    updateToolCallBox(box, summary, detailLines.join('\n\n'));
    return;
  }

  if (toolResult.toolName === 'grep' && output && typeof output === 'object') {
    const input = toolResult.input ?? toolResult.args ?? {};
    const detailsEl = buildGrepDetails(box.ownerDocument!, input, output);
    const excerpts = Array.isArray(output.excerpts) ? output.excerpts : [];
    const matchCount = typeof output.matches === 'number' ? output.matches : excerpts.length;
    const patternStr = typeof input.pattern === 'string' && input.pattern ? `“${input.pattern}”` : '';
    const summary = patternStr
      ? `${getString('tool-call-status-done')} · ${matchCount} ${matchCount === 1 ? 'match' : 'matches'} · ${patternStr}`
      : `${getString('tool-call-status-done')} · ${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`;
    updateToolCallBox(box, summary, detailsEl);
    return;
  }

  if (toolResult.toolName === 'tree' && output && typeof output === 'object' && typeof output.tree === 'string') {
    updateToolCallBox(box, getString('tool-call-status-done'), output.tree);
    return;
  }

  if (toolResult.toolName === 'read' && output && typeof output === 'object' && output.text) {
    updateToolCallBox(box, getString('tool-call-status-done'), output.text);
    return;
  }

  if (toolResult.toolName === 'capture_page' && output && typeof output === 'object' && output.dataUrl) {
    const imgDoc = box.ownerDocument;
    const img = imgDoc.createElement('img');
    img.src = output.dataUrl;
    img.classList.add('max-w-full', 'max-h-96', 'object-contain', 'rounded-lg', 'cursor-pointer');
    img.addEventListener('click', () => {
      const root = box.getRootNode() as any;
      let parent: HTMLElement;
      let ownerDoc: Document;
      if (root.host) {
        const reader = getReaderByTabId(addon.chatManager.currentTabID);
        if (reader) {
          const iframeWindow = (reader as any)._iframeWindow;
          const readerDoc = iframeWindow?.[0]?.document;
          if (readerDoc?.body) {
            parent = readerDoc.body;
            ownerDoc = readerDoc;
          } else {
            parent = root as unknown as HTMLElement;
            ownerDoc = imgDoc;
          }
        } else {
          parent = root as unknown as HTMLElement;
          ownerDoc = imgDoc;
        }
      } else {
        parent = imgDoc.body;
        ownerDoc = imgDoc;
      }
      createImageViewer([output.dataUrl], 0, parent, ownerDoc);
    });
    updateToolCallBox(box, `Page ${output.pageNumber}`, img);
    if (!session.capturedPageImages) session.capturedPageImages = [];
    session.capturedPageImages.push(output.dataUrl);
    return;
  }

  if (hasError) {
    const errDoc = box.ownerDocument;
    const errEl = errDoc.createElement('span');
    errEl.classList.add('text-red-600', 'dark:text-red-400');
    errEl.textContent = JSON.stringify(output, null, 2);
    updateToolCallBox(box, getString('tool-call-status-error'), errEl);
  } else {
    updateToolCallBox(box, getString('tool-call-status-done'), JSON.stringify(output, null, 2));
  }
}

function buildGrepDetails(doc: Document, input: any, output: any): HTMLElement {
  const container = doc.createElement('div');
  container.classList.add('flex', 'flex-col', 'gap-2');

  const params = doc.createElement('div');
  params.classList.add('flex', 'flex-wrap', 'gap-x-3', 'gap-y-1.5', 'pb-2', 'border-b', 'border-slate-200', 'dark:border-zinc-700');
  const paramItems: string[] = [];
  if (typeof input.pattern === 'string' && input.pattern) paramItems.push(`pattern: ${input.pattern}`);
  if (input.useRegex) paramItems.push('regex: true');
  if (input.maxResults != null) paramItems.push(`max: ${input.maxResults}`);
  if (input.itemId != null) paramItems.push(`itemId: ${input.itemId}`);
  for (const item of paramItems) {
    const pill = doc.createElement('span');
    pill.classList.add(
      'inline-flex',
      'items-center',
      'px-1.5',
      'py-0',
      'rounded-md',
      'bg-slate-200/70',
      'dark:bg-zinc-700/70',
      'text-slate-600',
      'dark:text-zinc-300'
    );
    pill.textContent = item;
    params.appendChild(pill);
  }
  container.appendChild(params);

  const results = doc.createElement('div');
  results.classList.add('whitespace-pre-wrap');
  const excerpts = Array.isArray(output.excerpts) ? output.excerpts : [];
  const lines: string[] = [];
  for (const m of excerpts) {
    const lineNo = m?.line != null ? `${m.line}` : '?';
    const pageStr = m?.page != null ? `(P${m.page})` : '';
    lines.push(`${lineNo}${pageStr}| ${m?.excerpt ?? ''}`);
  }
  results.textContent = lines.length > 0 ? lines.join('\n') : '(no matches)';
  container.appendChild(results);

  return container;
}

export function buildTranslateDetails(doc: Document, output: TranslationResult | any): HTMLElement {
  const t = output.textType as string;
  const container = doc.createElement('div');
  container.classList.add(
    'translate-result',
    'flex',
    'flex-col',
    'gap-1',
    'my-2',
    'p-4',
    'rounded-xl',
    'shadow-lg',
    'border',
    'border-slate-200',
    'dark:border-zinc-700',
    'border-l-4',
    'border-l-rose-500',
    'bg-white',
    'dark:bg-zinc-900'
  );

  if (t === 'word') {
    const normalizedPos = normalizePartOfSpeech(output.pos);
    const wordEl = doc.createElement('div');
    wordEl.classList.add('text-2xl', 'font-bold', 'text-slate-800', 'dark:text-zinc-100');
    wordEl.textContent = output.originalText;
    container.appendChild(wordEl);

    if (output.pronunciation) {
      const pronEl = doc.createElement('div');
      pronEl.classList.add('text-base', 'text-rose-600', 'dark:text-rose-400', 'font-mono');
      pronEl.textContent = output.pronunciation;
      container.appendChild(pronEl);
    }

    if (normalizedPos || output.translatedText) {
      const meaningEl = doc.createElement('div');
      meaningEl.classList.add('text-lg', 'text-slate-700', 'dark:text-zinc-200');
      if (normalizedPos) {
        const posSpan = doc.createElement('span');
        posSpan.classList.add('mr-1');
        posSpan.style.fontFamily = `ui-serif, Georgia, 'Times New Roman', Cambria, 'Songti SC', 'SimSun', 'Noto Serif CJK SC', serif`;
        posSpan.style.fontStyle = 'italic';
        posSpan.textContent = normalizedPos;
        meaningEl.appendChild(posSpan);
      }
      if (output.translatedText) {
        const meaningText = doc.createElement('span');
        meaningText.classList.add('font-bold');
        meaningText.textContent = output.translatedText;
        meaningEl.appendChild(meaningText);
      }
      container.appendChild(meaningEl);
    }

    if (output.explanation) {
      const explanationEl = doc.createElement('div');
      explanationEl.classList.add('text-sm', 'leading-relaxed', 'text-slate-500', 'dark:text-zinc-400');
      explanationEl.textContent = output.explanation;
      container.appendChild(explanationEl);
    }

    const validOtherMeanings: Array<{ pos: string; translatedText: string }> = Array.isArray(output.otherMeanings)
      ? output.otherMeanings
          .map((meaning: any) => ({ pos: normalizePartOfSpeech(meaning?.pos), translatedText: meaning?.translatedText }))
          .filter((meaning: any): meaning is { pos: string; translatedText: string } =>
            Boolean(meaning.pos && typeof meaning.translatedText === 'string' && meaning.translatedText.trim())
          )
      : [];
    if (validOtherMeanings.length > 0) {
      const divider = doc.createElement('div');
      divider.classList.add('border-t', 'border-slate-200', 'dark:border-zinc-600', 'my-1');
      container.appendChild(divider);

      for (const m of validOtherMeanings) {
        const otherEl = doc.createElement('div');
        otherEl.classList.add('text-base', 'text-slate-500', 'dark:text-zinc-400');
        const posSpan = doc.createElement('span');
        posSpan.classList.add('mr-1');
        posSpan.style.fontFamily = `ui-serif, Georgia, 'Times New Roman', Cambria, 'Songti SC', 'SimSun', 'Noto Serif CJK SC', serif`;
        posSpan.style.fontStyle = 'italic';
        posSpan.textContent = m.pos;
        otherEl.appendChild(posSpan);
        otherEl.appendChild(doc.createTextNode(m.translatedText));
        container.appendChild(otherEl);
      }
    }
  } else if (t === 'abbreviation') {
    const abbrEl = doc.createElement('div');
    abbrEl.classList.add('text-2xl', 'font-bold', 'text-slate-800', 'dark:text-zinc-100');
    abbrEl.textContent = output.originalText;
    container.appendChild(abbrEl);

    if (output.fullForm) {
      const fullEl = doc.createElement('div');
      fullEl.classList.add(
        'rounded-md',
        'bg-rose-100',
        'dark:bg-rose-900/40',
        'px-1.5',
        'py-0.5',
        'font-mono',
        'text-base',
        'font-medium',
        'text-rose-700',
        'dark:text-rose-300',
        'inline-block'
      );
      fullEl.textContent = output.fullForm;
      container.appendChild(fullEl);
    }

    const trans = output.translatedText;
    if (trans) {
      const transEl = doc.createElement('div');
      transEl.classList.add('text-lg', 'text-slate-700', 'dark:text-zinc-200');
      const label = doc.createElement('span');
      label.classList.add('text-sm', 'text-slate-500', 'dark:text-zinc-400', 'mr-1');
      label.textContent = 'abbr.';
      transEl.appendChild(label);
      const transText = doc.createElement('span');
      transText.classList.add('font-bold');
      transText.textContent = trans;
      transEl.appendChild(transText);
      container.appendChild(transEl);
    }

    if (output.explanation) {
      const explEl = doc.createElement('div');
      explEl.classList.add('text-base', 'text-slate-500', 'dark:text-zinc-400');
      explEl.textContent = output.explanation;
      container.appendChild(explEl);
    }
  } else if (t === 'text') {
    const translationEl = doc.createElement('div');
    translationEl.classList.add('translation-markdown', 'whitespace-pre-wrap', 'text-lg', 'leading-relaxed', 'text-slate-700', 'dark:text-zinc-200');
    translationEl.textContent = output.translatedText || '';
    container.appendChild(translationEl);
  }

  return container;
}

/** Replace the empty streaming placeholder with a validated translation card. */
export function onTranslationResultV2(session: Session, output: TranslationResult): void {
  onTranslationPartialV2(session, output);
  const pop = session.pending.messagePop as HTMLElement | undefined;
  if (!pop) return;
  pop.dataset.markdown = output.translatedText;
  if (output.textType === 'text') {
    const markdownEl = pop.querySelector('.translate-result .translation-markdown') as HTMLElement | null;
    if (markdownEl) {
      void renderMarkdown(output.translatedText, session.itemId).then((html) => {
        if (!markdownEl.isConnected) return;
        markdownEl.classList.remove('whitespace-pre-wrap');
        markdownEl.innerHTML = html;
        attachCitationHandlers(markdownEl);
        maybeAutoScroll(session);
      });
    }
  }
}

/** Render a partial structured object without ever exposing its JSON text. */
export function onTranslationPartialV2(session: Session, output: Partial<TranslationResult> & Record<string, any>): void {
  const pop = session.pending.messagePop as HTMLElement | undefined;
  const chatMessage = pop?.querySelector('.chat-message') as HTMLElement | null;
  if (!pop || !chatMessage) return;
  if (!output.textType && !output.translatedText) return;

  for (const content of chatMessage.querySelectorAll('.chat-message-content')) content.remove();
  for (const card of chatMessage.querySelectorAll('.translate-result')) card.remove();
  chatMessage.appendChild(buildTranslateDetails(chatMessage.ownerDocument!, output));
  session.pending.currentTextSegment = null;
  maybeAutoScroll(session);
}

export function clearTranslationPreviewV2(session: Session): void {
  const pop = session.pending.messagePop as HTMLElement | undefined;
  const chatMessage = pop?.querySelector('.chat-message') as HTMLElement | null;
  if (!chatMessage) return;
  for (const card of chatMessage.querySelectorAll('.translate-result')) card.remove();
}

export function onReasoningStartV2(session: Session) {
  const pop = session.pending.messagePop as HTMLElement | undefined;
  if (!pop) return;
  const chatMessage = pop.querySelector('.chat-message') as HTMLElement | null;
  if (!chatMessage) return;

  const doc = pop.ownerDocument!;
  const reasoningText = doc.createElement('div');
  reasoningText.classList.add('whitespace-pre-wrap');

  const box = ToolCallBox({
    doc,
    toolName: 'thinking',
    icon: Icons.Brain,
    summary: getString('thinking-card-title'),
    details: reasoningText,
    isExpanded: true,
  });

  // Remove any empty placeholder content divs so the reasoning card lands at
  // the true end of the stream order (text will create a fresh div after it).
  const contentDivs = chatMessage.querySelectorAll('.chat-message-content');
  for (const div of contentDivs) {
    if (!div.innerHTML.trim()) {
      div.remove();
    }
  }
  chatMessage.appendChild(box);

  session.pending.reasoningBox = box;
  session.pending.reasoningTextEl = reasoningText;
}

export function onReasoningDeltaV2(session: Session, text: string) {
  if (session.pending.reasoningTextEl) {
    session.pending.reasoningTextEl.textContent += text;
  }
  // Auto-scroll the thinking card's details panel so the latest reasoning
  // stays in view while tokens stream in.
  const reasoningBox = session.pending.reasoningBox as HTMLElement | undefined;
  if (reasoningBox) {
    const detailsPanel = reasoningBox.querySelector('.tool-call-details') as HTMLElement | null;
    if (detailsPanel) {
      detailsPanel.scrollTop = detailsPanel.scrollHeight;
    }
  }
  maybeAutoScroll(session);
}

export function onReasoningEndV2(session: Session) {
  const box = session.pending.reasoningBox as HTMLElement | undefined;
  if (!box) return;

  const summaryEl = box.querySelector('.tool-call-summary') as HTMLElement | null;
  if (summaryEl) summaryEl.textContent = getString('thinking-card-done');

  // Force-collapse (not toggle) so the card always folds up when this
  // reasoning segment ends, regardless of manual interaction during streaming.
  const detailsPanel = box.querySelector('.tool-call-details') as HTMLElement | null;
  const chevron = box.querySelector('.tool-call-chevron') as HTMLElement | null;
  if (detailsPanel) {
    detailsPanel.classList.remove('max-h-[32rem]', 'overflow-y-auto');
    detailsPanel.classList.add('max-h-0', 'overflow-hidden');
  }
  if (chevron) {
    chevron.classList.remove('rotate-180');
  }

  session.pending.reasoningBox = undefined;
  session.pending.reasoningTextEl = undefined;
}

/**
 * Consume the fullStream from a ToolLoopAgent result, rendering text deltas
 * and tool-call / tool-result UI in the current chat message bubble.
 *
 * Text segments and tool cards are interleaved in stream order:
 *   text-segment-1 → tool-card-1 → text-segment-2 → tool-card-2 → ...
 */
export async function consumeAgentStream(session: Session, result: any, refreshRate: number) {
  const pop = session.pending.messagePop as HTMLElement | undefined;
  if (!pop) return;

  const chatMessage = pop.querySelector('.chat-message') as HTMLElement | null;
  if (!chatMessage) return;

  const doc = pop.ownerDocument!;

  // Reuse the .chat-message-content created by onLLMStreamStartV2 for the
  // first text segment.  Clear the placeholder "Thinking..." on first content.
  let currentTextSegment = chatMessage.querySelector('.chat-message-content') as HTMLElement | null;
  let firstText = true;

  let textBuffer = '';
  let textChunkCount = 0;
  let aborted = false;
  let fullMarkdownBuffer = ''; // accumulate raw markdown for copy

  function ensureTextSegment(): HTMLElement {
    if (!currentTextSegment) {
      currentTextSegment = doc.createElement('div');
      currentTextSegment.classList.add('chat-message-content');
      chatMessage!.appendChild(currentTextSegment);
      // New final-answer segment: reset override and length-pause so the
      // 6px rule applies fresh (a previous override was scoped to the
      // prior segment that had exceeded the viewport).
      session.pending.scrollUserOverride = false;
      session.pending.scrollLengthPaused = false;
    }
    // Entering text mode: clear tool-phase flag so the 6px rule evaluates.
    session.pending.inToolPhase = false;
    session.pending.currentTextSegment = currentTextSegment;
    return currentTextSegment;
  }

  // Render the accumulated text buffer into the current segment.
  // Does NOT clear the buffer — callers are responsible for resetting
  // between segments via startNewTextSegment().
  async function flushTextBuffer(): Promise<void> {
    if (!textBuffer) return;
    const seg = ensureTextSegment();
    seg.innerHTML = await renderMarkdown(textBuffer, session.itemId);
    attachCitationHandlers(seg);
    textChunkCount = 0;
  }

  function startNewTextSegment(): void {
    currentTextSegment = null;
    textBuffer = '';
    textChunkCount = 0;
    session.pending.currentTextSegment = null;
  }

  /** Mark tool phase active: always-follow scroll, bypass 6px rule. */
  function enterToolPhase(): void {
    session.pending.inToolPhase = true;
    session.pending.scrollLengthPaused = false;
  }

  try {
    for await (const part of result.fullStream) {
      if (session.pending.abortController?.signal.aborted) {
        aborted = true;
        break;
      }

      switch (part.type) {
        case 'reasoning-start': {
          // If the current text segment is an empty placeholder, drop it so
          // the reasoning card is appended in true stream order and the next
          // text-delta creates a fresh segment after the reasoning card.
          if (currentTextSegment && !currentTextSegment.innerHTML.trim()) {
            currentTextSegment.remove();
            currentTextSegment = null;
          }
          // Reasoning is interim content, not the final answer — treat like
          // tool phase (always follow) so the reasoning card stays in view.
          enterToolPhase();
          onReasoningStartV2(session);
          break;
        }
        case 'reasoning-delta': {
          onReasoningDeltaV2(session, part.text);
          break;
        }
        case 'reasoning-end': {
          onReasoningEndV2(session);
          break;
        }
        case 'text-delta': {
          // Text deltas mean we've left the tool phase. Ensure the active
          // segment ref is synced even on non-flush chunks so maybeAutoScroll
          // can run the 6px check against the right element.
          if (session.pending.inToolPhase) {
            session.pending.inToolPhase = false;
            session.pending.scrollLengthPaused = false;
          }
          if (firstText) {
            firstText = false;
            if (currentTextSegment) currentTextSegment.innerHTML = '';
          }
          if (!currentTextSegment) ensureTextSegment();
          textBuffer += part.text; // AI SDK v6: field is `text`, not `textDelta`
          fullMarkdownBuffer += part.text;
          textChunkCount++;
          if (textChunkCount % refreshRate === 0) {
            ensureTextSegment();
            await flushTextBuffer();
          }
          break;
        }
        case 'tool-call':
          await flushTextBuffer();
          startNewTextSegment();
          enterToolPhase();
          // ask_user renders its own question cards; translate renders its own card on result
          if (part.toolName !== 'ask_user' && part.toolName !== 'translate') {
            onToolCallStartV2(session, part);
          }
          break;
        case 'tool-result':
          enterToolPhase();
          if (part.toolName === 'translate') {
            await flushTextBuffer();
            startNewTextSegment();
            const output = part.output ?? part.result;
            if (output && typeof output === 'object') {
              const card = buildTranslateDetails(doc, output);
              chatMessage!.appendChild(card);
            }
            break;
          }
          // ask_user results are already shown by the Q&A cards
          if (part.toolName !== 'ask_user') {
            onToolCallEndV2(session, part);
          }
          break;
        case 'tool-error': {
          ztoolkit.log('[chatUI] agent stream tool error part:', part);
          enterToolPhase();
          const errMsg = part.error || 'Tool execution failed';
          const errEl = doc.createElement('span');
          errEl.classList.add('text-red-600', 'dark:text-red-400');
          errEl.textContent = errMsg;
          const box = session.pending.toolCallBoxes?.get(part.toolCallId);
          if (box) {
            updateToolCallBox(box, getString('tool-call-status-error'), errEl);
          } else {
            const errBox = ToolCallBox({
              doc,
              toolName: part.toolName || 'unknown',
              summary: getString('tool-call-status-error'),
              details: errEl,
            });
            chatMessage!.appendChild(errBox);
          }
          break;
        }
        case 'error': {
          ztoolkit.log('[chatUI] agent stream error part:', part);
          const errObj = (part as any)?.error ?? part;
          const errMsg = buildErrorMessage(errObj);
          onLLMStreamErrorV2({ session, error: errMsg });
          aborted = true;
          break;
        }
      }

      if (session.pending.shouldAutoScroll) {
        maybeAutoScroll(session);
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      aborted = true;
    } else {
      ztoolkit.log('[chatUI] agent stream iteration failed:', e);
      const errMsg = buildErrorMessage(e);
      onLLMStreamErrorV2({ session, error: errMsg });
      aborted = true;
    }
  }

  // Flush remaining text (skip if buffer is empty to avoid creating an empty segment)
  if (textBuffer) {
    ensureTextSegment();
    await flushTextBuffer();
  }

  // Collect raw markdown for copy/regenerate
  (pop as HTMLElement).dataset.markdown = fullMarkdownBuffer.trim();

  let agentUsage: any;
  if (!aborted) {
    try {
      const response = await result.response;
      if (response?.messages && Array.isArray(response.messages)) {
        if (session.pending.userMessage) {
          session.conversationHistory.push(session.pending.userMessage);
        }
        session.conversationHistory.push(...response.messages);
      }
      agentUsage = (response as any)?.usage;
      if (!agentUsage) {
        try {
          agentUsage = await (result as any).usage;
        } catch (e) {
          ztoolkit.log('[chatUI] agent usage fetch failed:', e);
        }
      }
    } catch (e) {
      ztoolkit.log('[chatUI] failed to get agent response messages:', e);
    }
  }

  onLLMStreamEndV2(session, agentUsage);
}

export function onAgentAskUser(session: Session, payload: any) {
  Zotero.debug('[zaibar-chatui] onAgentAskUser questions=' + (payload.questions?.length || 0));
  const pop = session.pending.messagePop;
  if (!pop) {
    // Fallback if no message pop exists
    if (session.pending.userAnswerResolve) {
      session.pending.userAnswerResolve([]);
    }
    return;
  }

  const chatMessage = pop.querySelector('.chat-message') as HTMLElement | null;
  if (!chatMessage) {
    if (session.pending.userAnswerResolve) {
      session.pending.userAnswerResolve([]);
    }
    return;
  }

  const doc = pop.ownerDocument!;
  const questions: Array<{
    question: string;
    options: string[];
    multiple?: boolean;
  }> = payload.questions || [];

  const wrapper = doc.createElement('div');
  wrapper.classList.add(
    'agent-ask-user',
    'rounded-xl',
    'border',
    'border-slate-200',
    'dark:border-zinc-700',
    'bg-slate-50',
    'dark:bg-zinc-800',
    'p-3',
    'my-2'
  );

  const state: Array<{ selected: Set<number>; customInput: string }> = questions.map(() => ({ selected: new Set(), customInput: '' }));

  questions.forEach((q, qIndex) => {
    const qWrapper = doc.createElement('div');
    qWrapper.classList.add('agent-ask-user-question', 'mb-3');

    const qTitle = doc.createElement('div');
    qTitle.classList.add('text-sm', 'font-medium', 'text-slate-800', 'dark:text-zinc-100', 'mb-2');
    qTitle.textContent = q.question;
    qWrapper.appendChild(qTitle);

    const inputType = q.multiple ? 'checkbox' : 'radio';
    const groupName = `agent-ask-${session.id}-${qIndex}`;

    const customOptIndex = q.options.length; // virtual index for the custom input option

    q.options.forEach((option, optIndex) => {
      const label = doc.createElement('label');
      label.classList.add('flex', 'items-center', 'gap-2', 'text-sm', 'text-slate-700', 'dark:text-zinc-200', 'mb-1', 'cursor-pointer');

      const input = doc.createElement('input') as HTMLInputElement;
      input.type = inputType;
      input.name = groupName;
      input.value = option;
      input.addEventListener('change', () => {
        if (inputType === 'radio') {
          state[qIndex].selected.clear();
          state[qIndex].selected.add(optIndex);
          // clear custom input when a preset option is selected
          state[qIndex].customInput = '';
          customInput.value = '';
        } else {
          if (input.checked) {
            state[qIndex].selected.add(optIndex);
          } else {
            state[qIndex].selected.delete(optIndex);
          }
        }
      });

      label.appendChild(input);
      label.appendChild(doc.createTextNode(option));
      qWrapper.appendChild(label);
    });

    // Always show custom input with a radio/checkbox before it
    const customLabel = doc.createElement('label');
    customLabel.classList.add('flex', 'items-center', 'gap-2', 'text-sm', 'text-slate-700', 'dark:text-zinc-200', 'mb-1', 'cursor-pointer');

    const customRadio = doc.createElement('input') as HTMLInputElement;
    customRadio.type = inputType;
    customRadio.name = groupName;
    customRadio.value = '__custom__';

    const customInput = doc.createElement('input') as HTMLInputElement;
    customInput.type = 'text';
    customInput.classList.add(
      'flex-1',
      'px-2',
      'py-1',
      'text-sm',
      'rounded',
      'border',
      'border-slate-300',
      'dark:border-zinc-600',
      'bg-white',
      'dark:bg-zinc-900',
      'text-slate-800',
      'dark:text-zinc-100'
    );
    customInput.placeholder = getString('tool-call-ask-user-custom-placeholder');

    customRadio.addEventListener('change', () => {
      if (inputType === 'radio') {
        state[qIndex].selected.clear();
        state[qIndex].selected.add(customOptIndex);
      } else {
        if (customRadio.checked) {
          state[qIndex].selected.add(customOptIndex);
        } else {
          state[qIndex].selected.delete(customOptIndex);
        }
      }
    });

    customInput.addEventListener('focus', () => {
      // Auto-select the custom radio/checkbox when user starts typing
      if (!customRadio.checked) {
        customRadio.checked = true;
        customRadio.dispatchEvent(new Event('change'));
      }
    });
    customInput.addEventListener('input', () => {
      state[qIndex].customInput = customInput.value;
    });

    customLabel.appendChild(customRadio);
    customLabel.appendChild(customInput);
    qWrapper.appendChild(customLabel);

    wrapper.appendChild(qWrapper);
  });

  const submitBtn = doc.createElement('button');
  submitBtn.textContent = getString('tool-call-ask-user-submit');
  submitBtn.classList.add(
    'px-3',
    'py-1.5',
    'text-sm',
    'font-medium',
    'rounded-lg',
    'bg-rose-500',
    'text-white',
    'hover:bg-rose-600',
    'transition-colors'
  );

  let onAbort: (() => void) | undefined;
  const abortSignal = session.pending.abortController?.signal;

  submitBtn.addEventListener('click', () => {
    if (onAbort && abortSignal) {
      abortSignal.removeEventListener('abort', onAbort);
    }

    const answers = questions.map((q, i) => {
      const selectedIndices = Array.from(state[i].selected).sort((a, b) => a - b);
      const selectedOptions = selectedIndices.filter((idx) => idx < q.options.length).map((idx) => q.options[idx]);
      const hasCustom = selectedIndices.includes(q.options.length);
      return {
        question: q.question,
        selectedOptions,
        customInput: hasCustom && state[i].customInput ? state[i].customInput : undefined,
      };
    });

    try {
      // Replace question controls with a collapsible Q&A result card
      const details = doc.createElement('div');
      details.classList.add('flex', 'flex-col', 'gap-3');

      answers.forEach((a, i) => {
        const block = doc.createElement('div');
        block.classList.add('flex', 'flex-col', 'gap-2');
        if (i < answers.length - 1) {
          block.classList.add('border-b', 'border-slate-200', 'dark:border-zinc-700', 'pb-3');
        }

        const questionRow = doc.createElement('div');
        questionRow.classList.add('flex', 'items-center', 'gap-2');
        const qIcon = ztoolkit.UI.createElement(
          doc,
          'span',
          IconView({ iconMarkup: Icons.CircleQuestion, sizeRem: 0.9, extraClasses: ['text-rose-500', 'flex-shrink-0'] })
        );
        questionRow.appendChild(qIcon);
        const qText = doc.createElement('div');
        qText.classList.add('text-xs', 'font-medium', 'text-slate-700', 'dark:text-zinc-200');
        qText.textContent = a.question;
        questionRow.appendChild(qText);
        block.appendChild(questionRow);

        const answerRow = doc.createElement('div');
        answerRow.classList.add('flex', 'items-center', 'gap-2');
        const aIcon = ztoolkit.UI.createElement(
          doc,
          'span',
          IconView({ iconMarkup: Icons.MessageSquare, sizeRem: 0.9, extraClasses: ['text-emerald-500', 'flex-shrink-0'] })
        );
        answerRow.appendChild(aIcon);
        const aText = doc.createElement('div');
        aText.classList.add('text-xs', 'text-slate-600', 'dark:text-zinc-300');
        const selected = a.selectedOptions?.length ? a.selectedOptions.join(', ') : '(none)';
        const custom = a.customInput ? ` — ${a.customInput}` : '';
        aText.textContent = `${selected}${custom}`;
        answerRow.appendChild(aText);
        block.appendChild(answerRow);

        details.appendChild(block);
      });

      const resultBox = ToolCallBox({
        doc,
        toolName: 'ask_user',
        summary: getString('tool-call-status-done'),
        details,
        isExpanded: false,
      });

      wrapper.parentNode?.replaceChild(resultBox, wrapper);
    } catch (e: any) {
      Zotero.debug('[zaibar-chatui] ask_user submit failed: ' + (e?.message || e));
      ztoolkit.log('[chatUI] ask_user submit failed:', e);
    }

    if (session.pending.userAnswerResolve) {
      session.pending.userAnswerResolve(answers);
      session.pending.userAnswerResolve = undefined;
      session.pending.userAnswerReject = undefined;
    }
  });

  const btnRow = doc.createElement('div');
  btnRow.classList.add('flex', 'justify-end');
  btnRow.appendChild(submitBtn);
  wrapper.appendChild(btnRow);

  chatMessage.appendChild(wrapper);

  if (abortSignal) {
    onAbort = () => {
      abortSignal.removeEventListener('abort', onAbort!);
      if (session.pending.userAnswerReject) {
        session.pending.userAnswerReject(new DOMException('Aborted', 'AbortError'));
        session.pending.userAnswerResolve = undefined;
        session.pending.userAnswerReject = undefined;
      }
      wrapper.remove();
      updateSectionInputArea(session.id, false);
    };
    if (abortSignal.aborted) {
      onAbort();
      return;
    }
    abortSignal.addEventListener('abort', onAbort);
  }

  maybeAutoScroll(session);
}

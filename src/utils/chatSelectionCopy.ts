/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * chatSelectionCopy.ts
 *
 * This file is part of Zotero AI Bar.
 */

import { getString } from './locale';

const STATE_PROPERTY = '__zaibarChatSelectionCopyState';

type ChatSelectionCopyState = {
  containers: Set<HTMLElement>;
  activeContainer?: HTMLElement;
  popover?: HTMLElement;
  dismissTimer?: number;
  animationFrame?: number;
  shortcutHandled: boolean;
  keyHandler: (event: KeyboardEvent) => void;
  copyHandler: (event: ClipboardEvent) => void;
  commandHandler: (event: Event) => void;
  pointerHandler: (event: MouseEvent) => void;
  selectionHandler: () => void;
  viewportHandler: () => void;
  blurHandler: () => void;
};

type DocumentWithCopyState = Document & {
  [STATE_PROPERTY]?: ChatSelectionCopyState;
};

function elementForNode(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

function messageContainerForNode(node: Node | null): Element | null {
  return elementForNode(node)?.closest?.('.message-container') ?? null;
}

function mathRootForNode(node: Node | null): Element | null {
  const element = elementForNode(node);
  if (!element) return null;
  const katex = element.closest?.('.katex');
  if (katex?.parentElement?.classList.contains('katex-display')) return katex.parentElement;
  return katex ?? element.closest?.('.katex-display') ?? null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target && 'nodeType' in target ? elementForNode(target as Node) : null;
  if (!element) return false;
  const tagName = element.tagName?.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || (element as HTMLElement).isContentEditable;
}

function selectionsForContainer(doc: Document, container: HTMLElement): Selection[] {
  const selections: Selection[] = [];
  const root = container.getRootNode() as Document | ShadowRoot;
  const rootSelection = typeof (root as any).getSelection === 'function' ? ((root as any).getSelection() as Selection | null) : null;
  const documentSelection = doc.getSelection();
  if (rootSelection) selections.push(rootSelection);
  if (documentSelection && documentSelection !== rootSelection) selections.push(documentSelection);
  return selections;
}

function replaceRenderedMath(root: ParentNode, doc: Document): void {
  const replaceMath = (element: Element, display: boolean) => {
    const latex =
      element.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() ||
      element.querySelector('annotation')?.textContent?.trim() ||
      element.querySelector('.katex-mathml')?.textContent?.trim();
    if (!latex) return;
    const placeholder = doc.createElement('span');
    placeholder.setAttribute('data-zaibar-math', display ? 'display' : 'inline');
    placeholder.textContent = latex;
    element.replaceWith(placeholder);
  };
  root.querySelectorAll('.katex-display').forEach((element) => replaceMath(element, true));
  root.querySelectorAll('.katex').forEach((element) => replaceMath(element, false));
}

export function selectionToHtml(selection: Selection, doc: Document): string {
  const wrapper = doc.createElement('div');
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index).cloneRange();
    const startMath = mathRootForNode(range.startContainer);
    const endMath = mathRootForNode(range.endContainer);

    // A Range that begins or ends inside KaTeX clones only the selected visual
    // glyph nodes and drops the MathML annotation that contains the original
    // LaTeX. Expand just those boundaries to the formula root so copying any
    // part of a rendered formula consistently restores the whole expression.
    if (startMath) range.setStartBefore(startMath);
    if (endMath) range.setEndAfter(endMath);
    wrapper.appendChild(range.cloneContents());
  }
  wrapper.querySelectorAll('.tool-call-box, .chat-source-label, .chat-actions, script, style').forEach((element) => element.remove());
  replaceRenderedMath(wrapper, doc);
  return wrapper.innerHTML.replace(/\s+xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
}

type SelectedChatContent = {
  text: string;
  html: string;
  rect: DOMRect;
  container: HTMLElement;
};

function selectionRect(selection: Selection): DOMRect | undefined {
  if (!selection.rangeCount) return undefined;
  const range = selection.getRangeAt(selection.rangeCount - 1);
  const rects = range.getClientRects();
  return rects?.length ? rects[rects.length - 1] : range.getBoundingClientRect();
}

function contentFromSelection(selection: Selection, doc: Document, container: HTMLElement): SelectedChatContent | undefined {
  if (selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const html = selectionToHtml(selection, doc);
  const text = html.includes('data-zaibar-math') ? htmlToPlainText(html) : selection.toString();
  const rect = selectionRect(selection);
  if (!text || !rect) return undefined;
  return { text, html, rect, container };
}

function selectedChatContent(doc: Document, state: ChatSelectionCopyState): SelectedChatContent | undefined {
  for (const container of state.containers) {
    if (!container.isConnected) continue;
    for (const selection of selectionsForContainer(doc, container)) {
      const anchorContainer = messageContainerForNode(selection.anchorNode);
      const focusContainer = messageContainerForNode(selection.focusNode);
      if (anchorContainer === container && focusContainer === container) {
        const content = contentFromSelection(selection, doc, container);
        if (content) return content;
      }
    }
  }

  // Firefox can re-scope Shadow DOM selection endpoints to the host when the
  // selection is queried from a chrome/XUL document. The active container is
  // set on mousedown, so its root selection is safe to use as a fallback.
  const activeContainer = state.activeContainer;
  if (activeContainer?.isConnected) {
    for (const selection of selectionsForContainer(doc, activeContainer)) {
      const content = contentFromSelection(selection, doc, activeContainer);
      if (content) return content;
    }
  }
  return undefined;
}

function selectedChatText(doc: Document, state: ChatSelectionCopyState): string | undefined {
  return selectedChatContent(doc, state)?.text;
}

function writePlainText(text: string): void {
  new ztoolkit.Clipboard().addText(text, 'text/plain').copy();
}

function consumeCopyEvent(event: Event, text: string): void {
  writePlainText(text);
  event.preventDefault();
  event.stopPropagation();
}

function hideSelectionPopover(state: ChatSelectionCopyState, animated = false): void {
  const popover = state.popover;
  const view = popover?.ownerDocument.defaultView;
  if (animated && popover?.dataset.dismissing === 'true') return;
  if (state.dismissTimer !== undefined) {
    view?.clearTimeout(state.dismissTimer);
    state.dismissTimer = undefined;
  }
  if (state.animationFrame !== undefined) {
    view?.cancelAnimationFrame(state.animationFrame);
    state.animationFrame = undefined;
  }
  if (!popover) return;
  if (!animated || !view) {
    popover.remove();
    state.popover = undefined;
    return;
  }

  popover.dataset.dismissing = 'true';
  popover.style.pointerEvents = 'none';
  popover.style.opacity = '0';
  popover.style.transform = popover.dataset.placement === 'above' ? 'translateY(5px) scale(.97)' : 'translateY(-5px) scale(.97)';
  state.dismissTimer = view.setTimeout(() => {
    popover.remove();
    if (state.popover === popover) state.popover = undefined;
    state.dismissTimer = undefined;
  }, 180);
}

function showCopySuccess(doc: Document, state: ChatSelectionCopyState, popover: HTMLElement, button: HTMLButtonElement): void {
  if (state.popover !== popover) return;

  const darkMode = doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
  for (const item of Array.from(popover.querySelectorAll('button'))) {
    (item as HTMLButtonElement).disabled = true;
    (item as HTMLElement).style.cursor = 'default';
    (item as HTMLElement).style.opacity = item === button ? '1' : '.42';
  }
  button.textContent = `✓ ${getString('chat-selection-copy-copied')}`;
  button.style.background = darkMode ? 'rgba(34,197,94,.24)' : 'rgba(22,163,74,.14)';
  button.style.color = darkMode ? '#86efac' : '#15803d';
  popover.setAttribute('role', 'status');
  popover.setAttribute('aria-live', 'polite');
  popover.setAttribute('aria-label', getString('chat-selection-copy-copied'));

  state.dismissTimer = doc.defaultView?.setTimeout(() => {
    if (state.popover !== popover) return;
    hideSelectionPopover(state, true);
  }, 1000);
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === 3) {
    return (node.nodeValue ?? '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== 1) return '';
  const element = node as HTMLElement;
  if (element.hasAttribute('data-zaibar-copy-ignore')) return '';
  const tag = element.tagName.toLowerCase();
  const content = Array.from(element.childNodes).map(inlineMarkdown).join('');
  if (tag === 'br') return '  \n';
  if (tag === 'strong' || tag === 'b') return content.trim() ? `**${content.trim()}**` : '';
  if (tag === 'em' || tag === 'i') return content.trim() ? `*${content.trim()}*` : '';
  if (tag === 'del' || tag === 's') return content.trim() ? `~~${content.trim()}~~` : '';
  if (tag === 'code' && element.parentElement?.tagName.toLowerCase() !== 'pre') {
    const code = element.textContent ?? '';
    const fence = code.includes('`') ? '``' : '`';
    return `${fence}${code}${fence}`;
  }
  if (tag === 'a') {
    const href = element.getAttribute('href');
    return href && content.trim() ? `[${content.trim()}](${href})` : content;
  }
  return content;
}

function listMarkdown(list: Element, depth = 0): string {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === 'li');
  return items
    .map((item, index) => {
      const nestedLists = Array.from(item.children).filter((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase()));
      const content = Array.from(item.childNodes)
        .filter((child) => !(child.nodeType === 1 && ['ul', 'ol'].includes((child as Element).tagName.toLowerCase())))
        .map(markdownForNode)
        .join('')
        .replace(/\s*\n\s*/g, ' ')
        .trim();
      const indent = '  '.repeat(depth);
      const marker = ordered ? `${index + 1}.` : '-';
      const nested = nestedLists.map((child) => listMarkdown(child, depth + 1)).join('\n');
      return `${indent}${marker} ${content}${nested ? `\n${nested}` : ''}`;
    })
    .join('\n');
}

function tableMarkdown(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) => inlineMarkdown(cell).trim().replace(/\|/g, '\\|'))
  );
  if (!rows.length || !rows[0].length) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
  const renderRow = (row: string[]) => `| ${row.join(' | ')} |`;
  return [renderRow(normalized[0]), renderRow(Array(width).fill('---')), ...normalized.slice(1).map(renderRow)].join('\n');
}

function markdownForNode(node: Node): string {
  if (node.nodeType === 3) return (node.nodeValue ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const element = node as HTMLElement;
  if (element.hasAttribute('data-zaibar-copy-ignore')) return '';
  const tag = element.tagName.toLowerCase();
  const mathKind = element.getAttribute('data-zaibar-math');
  if (mathKind) {
    const latex = element.textContent?.trim() ?? '';
    return mathKind === 'display' ? `\n\n$$\n${latex}\n$$\n\n` : `$${latex}$`;
  }
  if (tag === 'pre') {
    const codeElement = element.querySelector('code');
    const language = codeElement?.className.match(/(?:language|lang)-([\w-]+)/)?.[1] ?? '';
    const code = (codeElement?.textContent ?? element.textContent ?? '').replace(/\n$/, '');
    return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
  }
  if (tag === 'ul' || tag === 'ol') return `\n\n${listMarkdown(element)}\n\n`;
  if (tag === 'table') return `\n\n${tableMarkdown(element)}\n\n`;
  const content = Array.from(element.childNodes).map(markdownForNode).join('');
  if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n\n`;
  if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') return `\n\n${content.trim()}\n\n`;
  if (tag === 'blockquote') {
    const quoted = content
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    return `\n\n${quoted}\n\n`;
  }
  if (tag === 'hr') return '\n\n---\n\n';
  return inlineMarkdown(element);
}

function plainTextForNode(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  if (node.nodeType !== 1) return '';
  const element = node as HTMLElement;
  if (element.hasAttribute('data-zaibar-copy-ignore')) return '';
  const tag = element.tagName.toLowerCase();
  const mathKind = element.getAttribute('data-zaibar-math');
  if (mathKind) {
    const latex = element.textContent?.trim() ?? '';
    return mathKind === 'display' ? `$$\n${latex}\n$$` : `$${latex}$`;
  }
  if (tag === 'br') return '\n';
  const content = Array.from(element.childNodes).map(plainTextForNode).join('');
  if (['p', 'div', 'section', 'article', 'blockquote', 'pre', 'tr'].includes(tag)) return `${content.trim()}\n`;
  if (tag === 'li') return `- ${content.trim()}\n`;
  return content;
}

export function htmlToPlainText(html: string): string {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return Array.from(parsed.body.childNodes)
    .map(plainTextForNode)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Convert an already-rendered chat element to plain text while retaining LaTeX delimiters. */
export function renderedElementToPlainText(element: Element): string {
  const clone = element.cloneNode(true) as HTMLElement;
  replaceRenderedMath(clone, element.ownerDocument);
  return htmlToPlainText(clone.innerHTML);
}

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return Array.from(parsed.body.childNodes)
    .map(markdownForNode)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function copyMarkdown(content: SelectedChatContent): void {
  writePlainText(htmlToMarkdown(content.html) || content.text);
}

function createPopoverButton(doc: Document, label: string, onClick: (button: HTMLButtonElement) => void | Promise<void>): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.classList.add('chat-selection-copy-button');
  button.textContent = label;
  button.style.cssText = [
    'min-height:26px',
    'padding:3px 10px',
    'border:0',
    'border-radius:9999px',
    'background:transparent',
    'color:inherit',
    'font:inherit',
    'font-size:12px',
    'font-weight:600',
    'line-height:20px',
    'white-space:nowrap',
    'cursor:pointer',
  ].join(';');
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void Promise.resolve(onClick(button)).catch((error) => {
      Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    });
  });
  return button;
}

export function calculateSelectionPopoverPosition(
  selectionRect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width'>,
  popoverSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
  gap = 8
): { left: number; top: number; placement: 'above' | 'below' } {
  const maximumLeft = Math.max(gap, viewportSize.width - popoverSize.width - gap);
  const preferredLeft = selectionRect.left + selectionRect.width / 2 - popoverSize.width / 2;
  const left = Math.max(gap, Math.min(preferredLeft, maximumLeft));
  const aboveTop = selectionRect.top - popoverSize.height - gap;
  const placement = aboveTop >= gap ? 'above' : 'below';
  const preferredTop = placement === 'above' ? aboveTop : selectionRect.bottom + gap;
  const maximumTop = Math.max(gap, viewportSize.height - popoverSize.height - gap);
  return { left, top: Math.max(gap, Math.min(preferredTop, maximumTop)), placement };
}

function showSelectionPopover(doc: Document, state: ChatSelectionCopyState): void {
  const content = selectedChatContent(doc, state);
  hideSelectionPopover(state);
  if (!content) return;

  const popover = doc.createElement('div');
  popover.classList.add('chat-selection-copy-popover');
  popover.setAttribute('role', 'toolbar');
  popover.setAttribute('aria-label', getString('chat-selection-copy-actions'));
  const darkMode = doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
  popover.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:2px',
    'padding:4px',
    `border:1px solid ${darkMode ? 'rgba(255,255,255,.16)' : 'rgba(15,23,42,.16)'}`,
    'border-radius:9999px',
    `background:${darkMode ? 'rgba(39,39,42,.98)' : 'rgba(255,255,255,.98)'}`,
    `color:${darkMode ? '#f4f4f5' : '#334155'}`,
    `box-shadow:${darkMode ? '0 8px 24px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.3)' : '0 8px 24px rgba(15,23,42,.2),0 2px 6px rgba(15,23,42,.12)'}`,
    'backdrop-filter:blur(12px)',
    'user-select:none',
    'pointer-events:auto',
    'opacity:0',
    'will-change:opacity,transform',
    'transition:opacity 160ms ease,transform 200ms cubic-bezier(.2,.8,.2,1)',
  ].join(';');
  popover.append(
    createPopoverButton(doc, getString('chat-selection-copy-markdown'), (button) => {
      copyMarkdown(content);
      showCopySuccess(doc, state, popover, button);
    }),
    createPopoverButton(doc, getString('chat-selection-copy-plain'), (button) => {
      writePlainText(content.text);
      showCopySuccess(doc, state, popover, button);
    })
  );

  // Mount outside the chat ShadowRoot. The sidebar host uses overflow:hidden,
  // which otherwise clips a fixed-position popup.
  (doc.body ?? doc.documentElement).appendChild(popover);
  state.popover = popover;

  const viewport = doc.defaultView;
  const popoverRect = popover.getBoundingClientRect();
  const position = calculateSelectionPopoverPosition(content.rect, popoverRect, {
    width: viewport?.innerWidth ?? doc.documentElement.clientWidth,
    height: viewport?.innerHeight ?? doc.documentElement.clientHeight,
  });
  popover.dataset.placement = position.placement;
  popover.style.left = `${Math.round(position.left)}px`;
  popover.style.top = `${Math.round(position.top)}px`;
  popover.style.transform = position.placement === 'above' ? 'translateY(7px) scale(.96)' : 'translateY(-7px) scale(.96)';

  if (viewport?.requestAnimationFrame) {
    state.animationFrame = viewport.requestAnimationFrame(() => {
      state.animationFrame = undefined;
      if (state.popover !== popover || popover.dataset.dismissing === 'true') return;
      popover.style.opacity = '1';
      popover.style.transform = 'translateY(0) scale(1)';
    });
  } else {
    popover.style.opacity = '1';
    popover.style.transform = 'translateY(0) scale(1)';
  }
}

/**
 * Pure shortcut helper retained for focused unit coverage. Runtime handling
 * additionally listens for Zotero's XUL cmd_copy command.
 */
export function handleChatSelectionCopyShortcut(event: KeyboardEvent, selection: Selection | null, writeText: (text: string) => void): boolean {
  if (event.defaultPrevented || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') return false;
  const eventTarget = event.composedPath?.()[0] ?? event.target;
  if (isEditableTarget(eventTarget) || !selection || selection.isCollapsed || selection.rangeCount === 0) return false;

  const anchorContainer = messageContainerForNode(selection.anchorNode);
  const focusContainer = messageContainerForNode(selection.focusNode);
  if (!anchorContainer || anchorContainer !== focusContainer) return false;

  const text = selection.toString();
  if (!text) return false;
  writeText(text);
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function installChatSelectionCopyHandler(doc: Document): void {
  const ownedDocument = doc as DocumentWithCopyState;
  if (ownedDocument[STATE_PROPERTY]) return;

  const state = {} as ChatSelectionCopyState;
  state.containers = new Set();
  state.shortcutHandled = false;
  state.keyHandler = (event) => {
    if (event.defaultPrevented || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') return;
    if (event.type === 'keydown' && !event.repeat) state.shortcutHandled = false;
    if (event.type === 'keyup' && state.shortcutHandled) {
      state.shortcutHandled = false;
      return;
    }
    if (state.shortcutHandled) return;
    const eventTarget = event.composedPath?.()[0] ?? event.target;
    if (isEditableTarget(eventTarget)) return;
    const text = selectedChatText(doc, state);
    if (text) {
      consumeCopyEvent(event, text);
      state.shortcutHandled = event.type !== 'keyup';
    }
  };
  state.copyHandler = (event) => {
    const eventTarget = event.composedPath?.()[0] ?? event.target;
    if (isEditableTarget(eventTarget)) return;
    const text = selectedChatText(doc, state);
    if (!text) return;
    if (event.clipboardData) {
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
      event.stopPropagation();
    } else {
      consumeCopyEvent(event, text);
    }
  };
  state.commandHandler = (event) => {
    const text = selectedChatText(doc, state);
    if (!text) return;
    consumeCopyEvent(event, text);
    event.stopImmediatePropagation();
  };
  state.pointerHandler = (event) => {
    const target = (event.composedPath?.()[0] ?? event.target) as Node | null;
    if (target && state.popover?.contains(target)) return;
    hideSelectionPopover(state, true);
  };
  state.selectionHandler = () => {
    if (!selectedChatText(doc, state)) hideSelectionPopover(state, true);
  };
  state.viewportHandler = () => hideSelectionPopover(state, true);
  state.blurHandler = () => hideSelectionPopover(state, true);

  ownedDocument[STATE_PROPERTY] = state;
  const eventRoot = doc.defaultView ?? doc;
  eventRoot.addEventListener('keydown', state.keyHandler as EventListener, true);
  eventRoot.addEventListener('keypress', state.keyHandler as EventListener, true);
  eventRoot.addEventListener('keyup', state.keyHandler as EventListener, true);
  doc.addEventListener('copy', state.copyHandler, true);
  doc.addEventListener('mousedown', state.pointerHandler, true);
  doc.addEventListener('selectionchange', state.selectionHandler);
  eventRoot.addEventListener('resize', state.viewportHandler as EventListener);
  eventRoot.addEventListener('blur', state.blurHandler as EventListener, true);
  doc.getElementById('cmd_copy')?.addEventListener('command', state.commandHandler, true);
}

export function registerChatSelectionCopyContainer(container: HTMLElement): void {
  const doc = container.ownerDocument;
  installChatSelectionCopyHandler(doc);
  const state = (doc as DocumentWithCopyState)[STATE_PROPERTY]!;
  state.containers.add(container);
  container.tabIndex = -1;
  container.style.outline = 'none';
  container.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    state.activeContainer = container;
    container.focus({ preventScroll: true });
  });
  container.addEventListener('mouseup', () => {
    doc.defaultView?.setTimeout(() => showSelectionPopover(doc, state), 0);
  });
  container.addEventListener('keyup', (event) => {
    if (event.shiftKey) showSelectionPopover(doc, state);
  });
  container.addEventListener('scroll', () => hideSelectionPopover(state, true), { passive: true });
}

export function uninstallChatSelectionCopyHandler(doc: Document): void {
  const ownedDocument = doc as DocumentWithCopyState;
  const state = ownedDocument[STATE_PROPERTY];
  if (!state) return;
  const eventRoot = doc.defaultView ?? doc;
  eventRoot.removeEventListener('keydown', state.keyHandler as EventListener, true);
  eventRoot.removeEventListener('keypress', state.keyHandler as EventListener, true);
  eventRoot.removeEventListener('keyup', state.keyHandler as EventListener, true);
  doc.removeEventListener('copy', state.copyHandler, true);
  doc.removeEventListener('mousedown', state.pointerHandler, true);
  doc.removeEventListener('selectionchange', state.selectionHandler);
  eventRoot.removeEventListener('resize', state.viewportHandler as EventListener);
  eventRoot.removeEventListener('blur', state.blurHandler as EventListener, true);
  doc.getElementById('cmd_copy')?.removeEventListener('command', state.commandHandler, true);
  hideSelectionPopover(state);
  delete ownedDocument[STATE_PROPERTY];
}

import { assert } from 'chai';
import {
  calculateSelectionPopoverPosition,
  handleChatSelectionCopyShortcut,
  htmlToMarkdown,
  htmlToPlainText,
  renderedElementToPlainText,
  selectionToHtml,
} from '../src/utils/chatSelectionCopy';
import { renderMarkdown } from '../src/utils/markdown';

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}) {
  let prevented = false;
  let stopped = false;
  const event = {
    key: 'c',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: null,
    composedPath: () => [],
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
    ...overrides,
  } as unknown as KeyboardEvent;
  return { event, prevented: () => prevented, stopped: () => stopped };
}

function selectionIn(container: Element, text: string) {
  const endpoint = {
    nodeType: 3,
    parentElement: { closest: (selector: string) => (selector === '.message-container' ? container : null) },
  } as unknown as Node;
  return {
    anchorNode: endpoint,
    focusNode: endpoint,
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
  } as unknown as Selection;
}

describe('chat selection copy', function () {
  it('serializes selected rich content as HTML', function () {
    const doc = Zotero.getMainWindow().document;
    const source = doc.createElement('div');
    source.innerHTML = '<p>Hello <strong>formatted</strong> text</p>';
    const range = doc.createRange();
    range.selectNodeContents(source);
    const selection = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
    assert.equal(selectionToHtml(selection, doc), '<p>Hello <strong>formatted</strong> text</p>');
  });

  it('converts rendered selection HTML to Markdown without an HTML clipboard flavor', function () {
    assert.equal(htmlToMarkdown('<p>Hello <strong>formatted</strong> text</p>'), 'Hello **formatted** text');
    assert.equal(htmlToMarkdown('<ul><li>One</li><li>Two</li></ul>'), '- One\n- Two');
  });

  it('restores inline and display formulas from the production KaTeX output', async function () {
    const doc = Zotero.getMainWindow().document;
    const source = doc.createElement('div');
    source.innerHTML = await renderMarkdown('Inline $E=mc^2$\n\n$$\n\\int_0^1 x\\,dx\n$$');
    const range = doc.createRange();
    range.selectNodeContents(source);
    const selection = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
    const html = selectionToHtml(selection, doc);

    assert.include(html, 'data-zaibar-math="inline"');
    assert.include(html, 'data-zaibar-math="display"');
    assert.equal(htmlToMarkdown(html), 'Inline $E=mc^2$\n\n$$\n\\int_0^1 x\\,dx\n$$');
    assert.equal(htmlToPlainText(html), 'Inline $E=mc^2$\n\n$$\n\\int_0^1 x\\,dx\n$$');
    assert.equal(renderedElementToPlainText(source), 'Inline $E=mc^2$\n\n$$\n\\int_0^1 x\\,dx\n$$');
  });

  it('renders a non-copyable code language header without adding it to copied content', async function () {
    const html = await renderMarkdown('```typescript\nconst answer = 42;\n```');

    assert.include(html, 'class="chat-code-block"');
    assert.include(html, 'class="chat-code-language">typescript</span>');
    assert.include(html, 'class="chat-code-copy-slot"');
    assert.notInclude(html, '<button');
    assert.notInclude(html, '<svg');
    assert.include(html, 'data-zaibar-copy-ignore="true"');
    assert.equal(htmlToMarkdown(html), '```typescript\nconst answer = 42;\n```');
    assert.equal(htmlToPlainText(html), 'const answer = 42;');
  });

  it('renders a current-document line citation with an unexpected title suffix', async function () {
    const html = await renderMarkdown('[cite:L49-L51|A 50 Gb/s 190 mW Asymmetric 3-Tap FFE VCSEL Driver]');

    assert.notInclude(html, '[cite:L49-L51|A 50 Gb/s 190 mW Asymmetric 3-Tap FFE VCSEL Driver]');
    assert.include(html, 'class="zaibar-cite"');
    assert.include(html, 'data-line="49"');
    assert.include(html, 'data-line-range="49-51"');
  });

  it('restores LaTeX when a selection boundary is inside rendered KaTeX', function () {
    const doc = Zotero.getMainWindow().document;
    const source = doc.createElement('p');
    source.innerHTML =
      'Before <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span><span class="katex-html">visual formula</span></span> after';
    const visualText = source.querySelector('.katex-html')!.firstChild!;
    const trailingText = source.lastChild!;
    const range = doc.createRange();
    range.setStart(visualText, 3);
    range.setEnd(trailingText, trailingText.textContent!.length);
    const selection = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;

    assert.equal(htmlToMarkdown(selectionToHtml(selection, doc)), '$E=mc^2$ after');
  });

  it('preserves display delimiters when selection starts inside display KaTeX', function () {
    const doc = Zotero.getMainWindow().document;
    const source = doc.createElement('div');
    source.innerHTML =
      '<div class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html">visual formula</span></span></div><p>After</p>';
    const visualText = source.querySelector('.katex-html')!.firstChild!;
    const trailingText = source.querySelector('p')!.firstChild!;
    const range = doc.createRange();
    range.setStart(visualText, 3);
    range.setEnd(trailingText, trailingText.textContent!.length);
    const selection = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;

    assert.equal(htmlToMarkdown(selectionToHtml(selection, doc)), '$$\nx^2\n$$\n\nAfter');
  });

  it('places the copy bubble above the selection and falls back below near the top edge', function () {
    const above = calculateSelectionPopoverPosition(
      { left: 100, right: 220, top: 160, bottom: 180, width: 120 },
      { width: 100, height: 32 },
      { width: 500, height: 400 }
    );
    assert.equal(above.placement, 'above');
    assert.equal(above.top, 120);

    const below = calculateSelectionPopoverPosition(
      { left: 100, right: 220, top: 12, bottom: 32, width: 120 },
      { width: 100, height: 32 },
      { width: 500, height: 400 }
    );
    assert.equal(below.placement, 'below');
    assert.equal(below.top, 40);
  });

  it('copies a selected chat transcript and consumes Ctrl+C', function () {
    const container = {} as Element;
    const shortcut = keyboardEvent();
    let copied = '';
    const handled = handleChatSelectionCopyShortcut(shortcut.event, selectionIn(container, 'selected answer'), (text) => {
      copied = text;
    });

    assert.isTrue(handled);
    assert.equal(copied, 'selected answer');
    assert.isTrue(shortcut.prevented());
    assert.isTrue(shortcut.stopped());
  });

  it('does not consume shortcuts without a chat selection', function () {
    const shortcut = keyboardEvent();
    const handled = handleChatSelectionCopyShortcut(shortcut.event, null, () => assert.fail('must not copy'));
    assert.isFalse(handled);
    assert.isFalse(shortcut.prevented());
  });

  it('does not replace native copy handling for editable controls', function () {
    const container = {} as Element;
    const textarea = { nodeType: 1, tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget;
    const shortcut = keyboardEvent({ composedPath: () => [textarea] });
    const handled = handleChatSelectionCopyShortcut(shortcut.event, selectionIn(container, 'stale selection'), () => assert.fail('must not copy'));
    assert.isFalse(handled);
    assert.isFalse(shortcut.prevented());
  });
});

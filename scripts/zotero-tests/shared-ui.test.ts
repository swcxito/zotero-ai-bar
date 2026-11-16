import { assert } from 'chai';
import { InputArea, type InputAreaAPI } from '../../src/components/inputArea';
import { setButtonIcon } from '../../src/components/buttonIcon';
import { registerModelInfoAnchor, refreshAllModelInfoAnchors, unregisterModelInfoAnchors } from '../../src/components/modelInfo';
import { renderMarkdown } from '../../src/utils/markdown';
import { openCitation } from '../../src/modules/citationAction';
import { attachCitationHandlers } from '../../src/modules/chatUI';
import { bindMenu, disposeMenusWithin } from '../../src/components/menuController';
import { openDropdownMenu } from '../../src/components/dropdownMenu';
import { createChatHistoryController } from '../../src/modules/chatViewController';
import type { Session } from '../../src/modules/chatManager';
import { htmlToMarkdown } from '../../src/utils/chatSelectionCopy';

describe('shared UI behavior in isolated Zotero', function () {
  let doc: Document;
  let shell: HTMLElement;
  let anchor: HTMLElement;
  let menu: HTMLElement | undefined;
  let controller: ReturnType<typeof bindMenu>;
  const wait = (milliseconds: number) => Zotero.Promise.delay(milliseconds);

  before(function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    doc = Zotero.getMainWindow().document;
  });

  beforeEach(function () {
    shell = doc.createElement('div');
    anchor = doc.createElement('span');
    shell.appendChild(anchor);
    doc.documentElement.appendChild(shell);
    menu = undefined;
  });

  afterEach(function () {
    controller?.dispose();
    shell.remove();
  });
  async function waitForClose() {
    const deadline = Date.now() + 1500;
    while (menu?.isConnected && Date.now() < deadline) await wait(20);
  }
  function build() {
    menu = doc.createElement('div');
    shell.appendChild(menu);
    return menu;
  }
  function enter() {
    anchor.dispatchEvent(new doc.defaultView!.MouseEvent('mouseenter'));
  }
  function leave() {
    anchor.dispatchEvent(new doc.defaultView!.MouseEvent('mouseleave'));
  }

  it('opens hover menus immediately and restores a menu re-entered during its fade', async function () {
    controller = bindMenu(anchor, build, 'hover');
    enter();
    assert.isTrue(menu?.isConnected);
    leave();
    await wait(280);
    assert.equal(menu?.style.opacity, '0');
    enter();
    await wait(180);
    assert.isTrue(menu?.isConnected);
    assert.equal(menu?.style.opacity, '1');
    leave();
    await waitForClose();
    assert.isFalse(menu?.isConnected);
    enter();
    leave();
    await waitForClose();
    assert.isFalse(menu?.isConnected, 'a reopened menu must retain its dismissal timer');
  });

  it('does not restart the leave timer as the pointer continues moving outside', async function () {
    controller = bindMenu(anchor, build, 'hover');
    enter();
    leave();
    await wait(150);
    shell.dispatchEvent(new doc.defaultView!.MouseEvent('mousemove', { bubbles: true, composed: true }));
    await wait(130);
    assert.equal(menu?.style.opacity, '0');
  });

  it('keeps model menus click-only and releases all document subscriptions on disposal', function () {
    const add = doc.addEventListener;
    const remove = doc.removeEventListener;
    const handlers = new Set<EventListenerOrEventListenerObject>();
    (doc as any).addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options: any) => {
      if (type === 'click' || type === 'mousemove') handlers.add(listener);
      add.call(doc, type, listener, options);
    };
    (doc as any).removeEventListener = (type: string, listener: EventListenerOrEventListenerObject, options: any) => {
      handlers.delete(listener);
      remove.call(doc, type, listener, options);
    };
    try {
      controller = bindMenu(anchor, build, 'click');
      enter();
      assert.isUndefined(menu);
      anchor.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true, composed: true }));
      assert.isTrue(menu?.isConnected);
      assert.equal(handlers.size, 2);
      controller.dispose();
      assert.equal(handlers.size, 0);
      assert.isFalse(menu?.isConnected);
    } finally {
      doc.addEventListener = add;
      doc.removeEventListener = remove;
    }
  });

  it('keeps hover bindings when a child document unloads', function () {
    controller = bindMenu(anchor, build, 'hover');
    const child = doc.createElementNS('http://www.w3.org/1999/xhtml', 'iframe') as HTMLIFrameElement;
    shell.appendChild(child);
    child.contentDocument!.dispatchEvent(new doc.defaultView!.Event('unload'));
    child.remove();
    enter();
    assert.isTrue(menu?.isConnected, 'closing a reader must not dispose the shared input menus');
  });

  it('purges dead Gecko model anchors without breaking live controls', function () {
    const sandbox = Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), { wantXrays: false, freshCompartment: true });
    const dead = Cu.evalInSandbox('({isConnected: true, nodeType: 1})', sandbox) as HTMLElement;
    Cu.nukeSandbox(sandbox);
    assert.throws(() => dead.isConnected);
    registerModelInfoAnchor(dead);
    refreshAllModelInfoAnchors();
    assert.isFalse(addon.data.modelInfoAnchors.has(dead));
    registerModelInfoAnchor(anchor);
    unregisterModelInfoAnchors(dead);
    assert.isTrue(addon.data.modelInfoAnchors.has(anchor));
    disposeMenusWithin(dead);
    unregisterModelInfoAnchors(shell);
  });

  it('renders header glyphs independently of skin button backgrounds', function () {
    const button = ztoolkit.UI.createElement(doc, 'button', { namespace: 'html' }) as HTMLButtonElement;
    shell.appendChild(button);
    button.style.setProperty('background', 'rgb(32, 40, 50)', 'important');
    setButtonIcon(button, 'chrome://zaibar/content/icons/chat-history.svg');
    const icon = button.querySelector('img')!;
    assert.equal(icon.namespaceURI, 'http://www.w3.org/1999/xhtml');
    assert.include(icon.src, 'chat-history.svg');
    assert.equal(icon.style.getPropertyValue('fill').toLowerCase(), 'currentcolor');
    setButtonIcon(button, 'chrome://zaibar/content/icons/chat-new.svg');
    assert.lengthOf(button.children, 1);
  });

  it('uses inherited skin colors for ripples across a Shadow DOM boundary', async function () {
    shell.style.setProperty('--accent-soft', 'rgb(51, 75, 104)');
    const shadow = shell.attachShadow({ mode: 'open' });
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'chrome://zaibar/content/zoteroAIBar.css';
    const loaded = new Promise<void>((resolve, reject) => {
      link.onload = () => resolve();
      link.onerror = () => reject(new Error('Ripple stylesheet failed to load'));
    });
    const ripple = doc.createElement('span');
    ripple.className = 'ripple';
    shadow.append(link, ripple);
    await loaded;
    assert.equal(doc.defaultView!.getComputedStyle(ripple).backgroundColor, 'rgb(51, 75, 104)');
  });

  it('shortens inline citations for the current item and its parent only', async function () {
    const get = Zotero.Items.get;
    const parent = { id: 901, getField: () => 'Current paper full title', isAttachment: () => false };
    const current = { id: 902, parentID: 901, isAttachment: () => true };
    const sibling = { id: 903, parentID: 901, isAttachment: () => true };
    const other = { id: 904, getField: () => 'Other paper full title', isAttachment: () => false };
    (Zotero.Items as any).get = (id: number) => ({ 901: parent, 902: current, 903: sibling, 904: other })[id];
    try {
      shell.innerHTML = await renderMarkdown('Inline [cite:902:2] [cite:901:3] [cite:904:4] [cite:903:5] [cite:901]', 902);
      const labels = [...shell.querySelectorAll('.zaibar-cite')].map((entry) => entry.textContent);
      assert.deepEqual(labels.slice(0, 3), ['p.2', 'p.3', 'Other paper full title · p.4']);
      assert.include(labels[3], 'Current paper full title', 'a sibling file remains distinguishable');
      assert.notInclude(labels[4], 'Current paper full title');
      const header = await renderMarkdown('[cite:901]', 902);
      assert.include(header, 'Current paper full title', 'standalone paper headers keep their title');
    } finally {
      Zotero.Items.get = get;
    }
  });

  it('opens the default citation file on click and chooses a file only on right click', async function () {
    const get = Zotero.Items.get;
    const open = Zotero.Reader.open;
    const prompt = Services.prompt;
    const debug = Zotero.debug;
    const diagnostics: string[] = [];
    (Zotero as any).debug = (message: unknown) => diagnostics.push(String(message));
    const first = {
      id: 912,
      parentID: 911,
      attachmentReaderType: 'pdf',
      attachmentContentType: 'application/pdf',
      isAttachment: () => true,
      isRegularItem: () => false,
      getField: () => 'First',
    };
    const best = { ...first, id: 913, getField: () => 'Default' };
    const html = { ...first, id: 914, attachmentReaderType: 'snapshot', attachmentContentType: 'text/html' };
    const parent = {
      id: 911,
      isAttachment: () => false,
      isRegularItem: () => true,
      getAttachments: () => [912, 913, 914],
      getBestAttachment: async () => best,
    };
    const opened: any[] = [];
    let choices = 0;
    (Zotero.Items as any).get = (id: number) => ({ 911: parent, 912: first, 913: best, 914: html })[id];
    (Zotero.Reader as any).open = async (...args: any[]) => {
      opened.push(args);
    };
    (Services as any).prompt = {
      select: (...args: any[]) => {
        choices++;
        args[4].value = 0;
        return true;
      },
    };
    try {
      shell.innerHTML = '<span class="zaibar-cite" data-item-id="911" data-page="3">p.3</span>';
      attachCitationHandlers(shell);
      const pill = shell.firstElementChild!;
      pill.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true }));
      await wait(10);
      assert.equal(choices, 0);
      assert.deepEqual(opened[0], [913, { pageIndex: 2 }, { allowDuplicate: false }]);
      const rightClick = new doc.defaultView!.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
      pill.dispatchEvent(rightClick);
      await wait(10);
      assert.equal(choices, 1, diagnostics.join('\n'));
      assert.equal(opened[1][0], 912);
      assert.isUndefined(opened[1][1], 'choosing a different file must not reuse the default file page');
      await openCitation(914, 10);
      assert.isUndefined(opened[2][1], 'non-PDFs receive no invented page');
      (Services as any).prompt = { select: () => false };
      await openCitation(912, 3, true);
      assert.lengthOf(opened, 3, 'cancelling the chooser opens nothing');
    } finally {
      Zotero.Items.get = get;
      Zotero.Reader.open = open;
      (Services as any).prompt = prompt;
      Zotero.debug = debug;
    }
  });

  it('recognizes clicks within a Shadow DOM menu and closes on outside clicks', function () {
    const shadow = shell.attachShadow({ mode: 'open' });
    shadow.appendChild(anchor);
    controller = bindMenu(
      anchor,
      () => {
        menu = doc.createElement('div');
        shadow.appendChild(menu);
        return menu;
      },
      'hover'
    );
    enter();
    menu!.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true, composed: true }));
    assert.isTrue(menu?.isConnected);
    shell.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true, composed: true }));
    assert.isFalse(menu?.isConnected);
  });

  it('anchors drop-up choices two pixels above a bottom-aligned composer button', function () {
    shell.style.cssText = 'position:fixed;left:30px;bottom:20px;width:260px;display:flex;flex-direction:column';
    const composer = doc.createElement('div');
    composer.style.cssText = 'position:relative;display:flex;flex-direction:column';
    anchor.style.cssText = 'display:block;height:28px;width:40px';
    shell.appendChild(composer);
    composer.appendChild(anchor);
    const originalAnchor = anchor.getBoundingClientRect();
    for (const align of ['center', 'left'] as const) {
      const popup = openDropdownMenu({
        menuId: 'geometry-fixture',
        anchor,
        container: composer,
        dropUp: true,
        align,
        presentation: { menu: 'thinking-effort-dropdown', title: 'title', item: 'item', minWidth: '104px' },
        groups: [
          {
            title: 'Thinking',
            items: [
              { id: 'low', label: 'Low' },
              { id: 'high', label: 'High' },
            ],
          },
        ],
      });
      const menuRect = popup.getBoundingClientRect(),
        buttonRect = anchor.getBoundingClientRect();
      assert.closeTo(buttonRect.top, originalAnchor.top, 0.5, 'inserting a menu must not move its button');
      assert.closeTo(menuRect.bottom, buttonRect.top - 2, 0.5, 'menu must not be displaced by its own height');
      if (align === 'center') assert.closeTo(menuRect.left + menuRect.width / 2, buttonRect.left + buttonRect.width / 2, 0.5);
      else assert.closeTo(menuRect.left, buttonRect.left, 0.5);
      popup.remove();
    }
  });

  it('removes the next message reference immediately when the reader selection is cancelled', async function () {
    const id = `selection-cancel-${Date.now()}`;
    const originalSelection = addon.data.selection;
    const originalSend = addon.chatManager.sendChatRequest;
    const requests: any[] = [];
    let position: any = { pageIndex: 0 };
    const messages = doc.createElement('div');
    shell.appendChild(messages);
    addon.data.selection = {
      text: 'Selected reference',
      currentReader: { tabID: id, _internalReader: { getSelectionPosition: () => position } } as any,
      contextPromise: Promise.resolve(['before', 'Selected reference', 'after']),
    };
    addon.chatManager.sendChatRequest = async (request) => {
      requests.push(request);
    };
    const wrapper = InputArea(doc, id, { sourceTabId: id, resolveMessageContainer: () => messages });
    shell.appendChild(wrapper);
    addon.data.sharedInputAreas.add(wrapper);
    const api = (wrapper as any)._inputAreaAPI as InputAreaAPI;
    const textarea = wrapper.querySelector('textarea')!;
    async function send(text: string) {
      textarea.value = text;
      textarea.dispatchEvent(new doc.defaultView!.Event('input', { bubbles: true }));
      textarea.dispatchEvent(new doc.defaultView!.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(30);
    }
    try {
      await send('First question');
      assert.equal(requests[0].selectionSnapshot.text, 'Selected reference');
      assert.lengthOf(messages.querySelectorAll('.chat-reference-card'), 1);
      position = null;
      await send('Follow-up without a reference');
      assert.lengthOf(requests, 2);
      assert.isUndefined(requests[1].selectionSnapshot.text);
      assert.isUndefined(requests[1].selectionSnapshot.contextPromise);
      assert.lengthOf(messages.querySelectorAll('.chat-reference-card'), 1, 'The historical message keeps its reference');
      assert.isNull(messages.lastElementChild!.querySelector('.chat-reference-card'));
      assert.equal(wrapper.dataset.selectionHintVisible, 'false');
    } finally {
      api.dispose();
      addon.data.sharedInputAreas.delete(wrapper);
      addon.data.selection = originalSelection;
      addon.chatManager.sendChatRequest = originalSend;
      addon.chatManager.sessionsMap.delete(id);
      addon.data.inputDraftTexts.delete(id);
    }
  });

  it('opens fixed workspace mode menus for inspection while keeping their choices disabled', function () {
    const ids = [`fixed-menu-${Date.now()}`, `article-menu-${Date.now()}`];
    const shadow = shell.attachShadow({ mode: 'open' });
    const wrapper = InputArea(doc, ids[0], { sessionKind: 'global-agent', chatModeAdjustable: false });
    shadow.appendChild(wrapper);
    const api = (wrapper as any)._inputAreaAPI as InputAreaAPI;
    const button = wrapper.querySelector<HTMLElement>('.input-chat-mode-btn')!;
    try {
      assert.notEqual(button.getAttribute('aria-disabled'), 'true', 'the menu trigger must remain available');
      button.dispatchEvent(new doc.defaultView!.MouseEvent('mouseenter'));
      let popup = shadow.querySelector('.chat-mode-dropdown')!;
      assert.isNotNull(popup);
      assert.lengthOf(popup.querySelectorAll('button:disabled'), 3);
      assert.equal(popup.querySelector('.is-selected')?.textContent, 'Agent');
      api.setContext({ sessionId: ids[1], sessionKind: 'article', chatModeAdjustable: true });
      button.dispatchEvent(new doc.defaultView!.MouseEvent('mouseenter'));
      popup = shadow.querySelector('.chat-mode-dropdown')!;
      assert.isNotNull(popup);
      assert.lengthOf(popup.querySelectorAll('button:enabled'), 3, 'article modes remain selectable');
    } finally {
      api.dispose();
      for (const id of ids) addon.chatManager.sessionsMap.delete(id);
    }
  });

  it('uses XML-safe shared option controls and respects disabled options', function () {
    let selected = 0;
    controller = bindMenu(
      anchor,
      () => {
        menu = openDropdownMenu({
          menuId: 'shared-menu-fixture',
          anchor,
          container: shell,
          groups: [
            {
              items: [
                { id: 'disabled', label: 'Disabled', disabled: true, onClick: () => selected++ },
                { id: 'enabled', label: 'Enabled', onClick: () => selected++ },
              ],
            },
          ],
        });
        return menu;
      },
      'hover'
    );
    enter();
    const buttons = menu!.querySelectorAll('button');
    assert.lengthOf(buttons, 2);
    assert.equal(buttons[0].namespaceURI, 'http://www.w3.org/1999/xhtml');
    assert.isTrue((buttons[0] as HTMLButtonElement).disabled);
    buttons[0].dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true }));
    assert.equal(selected, 0);
    buttons[1].dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true }));
    assert.equal(selected, 1);
    assert.isFalse(menu!.isConnected);
    controller.open();
    assert.isTrue(menu!.isConnected);
  });

  it('settles interrupted history animations without leaving input disabled', async function () {
    const history = createChatHistoryController();
    const deck = doc.createElement('div');
    const inputHost = doc.createElement('div');
    const historyHost = doc.createElement('div');
    const page = doc.createElement('div');
    shell.append(deck, inputHost, historyHost);
    historyHost.dataset.sessionId = 'fixture';
    historyHost.appendChild(doc.createElement('div'));
    const session = { id: 'fixture', kind: 'article', pending: {} } as Session;
    const view = {
      deck,
      inputHost,
      historyHost,
      historyButton: null,
      newButton: null,
      setIcon: () => {},
      refresh: () => {},
      deckDisplay: 'flex',
      inputDisplay: 'block',
    };
    historyHost.dataset.visible = 'true';
    history.visible = true;
    history.update(session, page, view);
    history.visible = false;
    history.update(session, page, view);
    history.update(session, page, view);
    await wait(230);
    assert.equal(inputHost.style.display, 'block');
    assert.equal(inputHost.style.pointerEvents, '');
    assert.isFalse(history.animating);
    history.dispose();
  });

  it('retains literal Markdown, ordered-list starts, nested lists and safe code fences', function () {
    assert.equal(htmlToMarkdown('<p>*literal*</p>'), '\\*literal\\*');
    assert.match(htmlToMarkdown('<ol start="3"><li>Third</li></ol>'), /^3\.\s+Third$/);
    assert.include(htmlToMarkdown('<ul><li>Parent<ul><li>Child</li></ul></li></ul>'), 'Child');
    const markdown = htmlToMarkdown('<pre><code>first\n```\nlast</code></pre>');
    assert.match(markdown, /^````\n/);
    assert.match(markdown, /\n````$/);
    assert.equal(htmlToMarkdown('<p>Keep<span data-zaibar-copy-ignore="true">Remove</span></p>'), 'Keep');
  });
});

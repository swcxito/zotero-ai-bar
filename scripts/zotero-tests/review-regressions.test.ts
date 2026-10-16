import { assert } from 'chai';
import { renderMarkdown } from '../../src/utils/markdown';
import { renderPersistedTranscript } from '../../src/modules/chatUI';
import { Session } from '../../src/modules/chatManager';
import { grepInTextPaginated } from '../../src/utils/textSearch';
import { openDropdownMenu, closeDropdownMenu } from '../../src/components/dropdownMenu';
import { bindMenu } from '../../src/components/menuController';
import { createChatTurnNavigator } from '../../src/components/chatTurnNavigator';

describe('review regressions in isolated Zotero', function () {
  let doc: Document;
  let host: HTMLElement;
  const wait = () => Zotero.Promise.delay(80);

  before(function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    (globalThis as any).addon = (Zotero as any).ZAIBar;
    (globalThis as any).ztoolkit = addon.data.ztoolkit;
    doc = Zotero.getMainWindow().document;
  });

  beforeEach(function () {
    host = doc.createElement('div');
    host.style.cssText = 'position:fixed;left:10px;top:10px;width:600px;height:400px;z-index:99999';
    doc.documentElement.appendChild(host);
  });

  afterEach(function () {
    host.remove();
  });

  it('bounds pathological regex matching without changing substring or literal matching', function () {
    const start = Date.now();
    const result = grepInTextPaginated('a'.repeat(24) + '!', '(a+)+$', true, 1, 0);
    assert.equal(result.totalMatches, 0);
    assert.isBelow(Date.now() - start, 250, 'regex evaluation must not block the UI');
    assert.equal(grepInTextPaginated('prefix HELLO suffix', 'hello', true, 1, 0).totalMatches, 1);
    assert.equal(grepInTextPaginated('[a+]', '[a+]', false, 1, 0).totalMatches, 1);
  });

  it('preserves citation and HTML literals inside fenced and indented code', async function () {
    for (const source of ['```text\n[cite:p1]\n<sub>x</sub>\n```', '    [cite:p1]\n    <sub>x</sub>']) {
      host.innerHTML = await renderMarkdown(source, 999999);
      assert.isNull(host.querySelector('.zaibar-cite'));
      assert.include(host.querySelector('pre code')!.textContent!, '[cite:p1]');
      assert.include(host.querySelector('pre code')!.textContent!, '<sub>x</sub>');
    }
  });

  it('keeps inline code literal while preserving wrapped citations and table titles', async function () {
    host.innerHTML = await renderMarkdown('`[cite:p1]` and **[cite:p2]** and *[cite:p3]* and [[cite:p4]](https://example.org)', 999999);
    assert.equal(host.querySelector('code')!.textContent, '[cite:p1]');
    assert.lengthOf(host.querySelectorAll('.zaibar-cite'), 3);
    assert.isNull(host.querySelector('strong, em, a'));
    host.innerHTML = await renderMarkdown('| A | B |\n| --- | --- |\n| [cite:p1|title] | other |', 999999);
    assert.lengthOf(host.querySelectorAll('tbody td'), 2);
    assert.lengthOf(host.querySelectorAll('tbody .zaibar-cite'), 1);
  });

  it('does not commit an old transcript after a replacement render or new conversation', async function () {
    const session = new Session('history-race-review', { kind: 'article' });
    session.conversationId = 'old';
    session.persistedTurns = [{ id: 'old-turn', createdAt: 1, assistantMarkdown: 'old answer' }];
    const rendering = renderPersistedTranscript(session, host);
    session.conversationId = 'new';
    session.persistedTurns = [];
    host.replaceChildren();
    host.dataset.conversationId = 'new';
    host.dataset.renderToken = 'replacement';
    await rendering;
    assert.equal(host.textContent, '');
  });

  it('uses the tool surface token even with its existing Tailwind background class', async function () {
    const shadow = host.attachShadow({ mode: 'open' });
    const root = doc.createElement('div');
    root.dataset.zaibarSkin = 'rose';
    const tool = doc.createElement('div');
    tool.className = 'tool-call-box bg-slate-50 dark:bg-zinc-800 rounded-xl';
    const expected = doc.createElement('div');
    expected.style.backgroundColor = 'var(--surface)';
    root.append(tool, expected);
    shadow.appendChild(root);
    await new Promise<void>((resolve, reject) => {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'chrome://zaibar/content/styles/skins.css';
      link.onload = () => resolve();
      link.onerror = () => reject(new Error('styles not loaded'));
      shadow.appendChild(link);
    });
    assert.equal(doc.defaultView!.getComputedStyle(tool).backgroundColor, doc.defaultView!.getComputedStyle(expected).backgroundColor);
  });

  it('flips a menu at the top edge and follows its moved anchor', async function () {
    host.style.cssText = 'position:fixed;left:30px;top:4px;width:260px;height:300px;z-index:99999';
    const anchor = doc.createElement('button');
    anchor.style.cssText = 'width:40px;height:28px';
    host.appendChild(anchor);
    const menu = openDropdownMenu({
      menuId: 'review-geometry',
      anchor,
      container: host,
      dropUp: true,
      presentation: { menu: 'review-menu', title: 'title', item: 'item', minWidth: '104px' },
      groups: [
        {
          items: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    });
    menu.style.cssText += ';width:150px;height:80px';
    try {
      await wait();
      assert.isAtLeast(menu.getBoundingClientRect().top, 0);
      host.style.top = '100px';
      await wait();
      assert.closeTo(menu.getBoundingClientRect().bottom, anchor.getBoundingClientRect().top - 2, 1);
    } finally {
      closeDropdownMenu(doc, 'review-geometry');
    }
  });

  it('closes click menus with Escape and returns focus to the anchor', function () {
    const anchor = doc.createElement('button');
    host.appendChild(anchor);
    const controller = bindMenu(
      anchor,
      () => {
        const menu = doc.createElement('div');
        host.appendChild(menu);
        return menu;
      },
      'click'
    );
    try {
      controller.open();
      doc.dispatchEvent(new doc.defaultView!.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.lengthOf(host.children, 1);
      assert.strictEqual(doc.activeElement, anchor);
    } finally {
      controller.dispose();
    }
  });

  it('does not remeasure every turn for scroll-only navigation updates', async function () {
    const messages = doc.createElement('div');
    messages.style.cssText = 'height:200px;overflow:auto';
    let measurements = 0;
    for (let i = 0; i < 100; i++) {
      const turn = doc.createElement('div');
      turn.dataset.chatRole = 'user';
      turn.style.height = '40px';
      const original = turn.getBoundingClientRect.bind(turn);
      turn.getBoundingClientRect = () => {
        measurements++;
        return original();
      };
      messages.appendChild(turn);
    }
    const navigator = createChatTurnNavigator(doc, messages);
    host.appendChild(navigator.shell);
    navigator.shell.style.cssText = 'width:600px;height:200px';
    try {
      navigator.refresh();
      await wait();
      measurements = 0;
      for (let i = 0; i < 5; i++) {
        messages.scrollTop += 40;
        messages.dispatchEvent(new doc.defaultView!.Event('scroll'));
        await wait();
      }
      assert.isBelow(measurements, 100, 'scroll-only refreshes should reuse turn geometry');
    } finally {
      navigator.dispose();
    }
  });
});

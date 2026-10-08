import { assert } from 'chai';
import { CHAT_SKINS, normalizeChatSkin, registerChatSkinRoot, refreshChatSkin, startChatSkinSync, stopChatSkinSync } from '../src/utils/chatSkin';
import { getPref, setPref } from '../src/utils/prefs';

const NEW_SKINS = ['neumorphism'] as const;
const PAGE_COLORS = {
  neumorphism: ['#e9eef5', '#242e3b'],
};

/** Wait for imports too, rather than treating an attached CSSStyleSheet as loaded. */
function loadSkinStyles(doc: Document, parent: Element | ShadowRoot): Promise<HTMLLinkElement> {
  return new Promise((resolve, reject) => {
    const link = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link') as HTMLLinkElement;
    link.rel = 'stylesheet';
    link.href = 'chrome://zaibar/content/styles/skins.css';
    const timer = doc.defaultView!.setTimeout(() => reject(new Error('Skin stylesheet did not load')), 5000);
    link.addEventListener(
      'load',
      () => {
        doc.defaultView!.clearTimeout(timer);
        resolve(link);
      },
      { once: true }
    );
    link.addEventListener(
      'error',
      () => {
        doc.defaultView!.clearTimeout(timer);
        reject(new Error('Skin stylesheet failed to load'));
      },
      { once: true }
    );
    parent.appendChild(link);
  });
}

function computed(node: Element): CSSStyleDeclaration {
  return node.ownerDocument.defaultView!.getComputedStyle(node);
}

function expectedPage(doc: Document, skin: (typeof NEW_SKINS)[number]): string {
  return PAGE_COLORS[skin][doc.defaultView!.matchMedia('(prefers-color-scheme: dark)').matches ? 1 : 0];
}

function htmlElement(doc: Document, name: string, className = ''): HTMLElement {
  const node = doc.createElementNS('http://www.w3.org/1999/xhtml', name) as HTMLElement;
  node.className = className;
  return node;
}

async function verifyShadowRootMaterial(skin: (typeof NEW_SKINS)[number]): Promise<void> {
  const original = getPref('chat.skin');
  const doc = Zotero.getMainWindow().document;
  const host = htmlElement(doc, 'div');
  const shadow = host.attachShadow({ mode: 'open' });
  const root = htmlElement(doc, 'div');
  const input = htmlElement(doc, 'div', 'input-area');
  const tool = htmlElement(doc, 'div', 'tool-call-box');
  const textarea = htmlElement(doc, 'textarea');
  input.appendChild(textarea);
  root.append(input, tool);
  shadow.appendChild(root);
  doc.documentElement.appendChild(host);
  try {
    await loadSkinStyles(doc, shadow);
    setPref('chat.skin', skin);
    registerChatSkinRoot(root);
    assert.equal(computed(root).getPropertyValue('--page').trim(), expectedPage(doc, skin));
    assert.equal(computed(host).getPropertyValue('--page').trim(), '');
    assert.notEqual(computed(tool).boxShadow, 'none');
    assert.include(computed(input).boxShadow, 'inset');
    setPref('chat.skin', 'rose');
    refreshChatSkin();
    await new Promise<void>((resolve) => doc.defaultView!.setTimeout(resolve, 350));
    assert.notInclude(computed(input).boxShadow, 'inset');
  } finally {
    stopChatSkinSync();
    host.remove();
    setPref('chat.skin', original || 'rose');
  }
}

describe('chat skins', function () {
  it('keeps six skin IDs and falls back to Rose for invalid preferences', function () {
    assert.deepEqual(CHAT_SKINS, ['rose', 'paper', 'neumorphism', 'moss', 'tactical', 'bw']);
    for (const skin of CHAT_SKINS) assert.equal(normalizeChatSkin(skin), skin);
    assert.equal(normalizeChatSkin('abyss'), 'neumorphism');
    for (const invalid of ['unknown', '', undefined, null, 1]) assert.equal(normalizeChatSkin(invalid), 'rose');
  });

  it('updates open plugin roots through the refreshed Abyss skin and back to Rose', async function () {
    const original = getPref('chat.skin');
    const doc = Zotero.getMainWindow().document;
    const root = htmlElement(doc, 'div');
    doc.documentElement.appendChild(root);
    try {
      await loadSkinStyles(doc, root);
      startChatSkinSync();
      registerChatSkinRoot(root);
      for (const skin of [...NEW_SKINS, 'rose'] as const) {
        setPref('chat.skin', skin);
        await new Promise<void>((resolve) => doc.defaultView!.setTimeout(resolve, 30));
        assert.equal(root.getAttribute('data-zaibar-skin'), skin);
        // Unregistered @property tokens also prove the palette import loaded.
        if (skin !== 'rose') assert.equal(computed(root).getPropertyValue('--page').trim(), expectedPage(doc, skin));
      }
      assert.equal(computed(root).getPropertyValue('--za-neu-inset').trim(), '');
    } finally {
      stopChatSkinSync();
      root.remove();
      setPref('chat.skin', original || 'rose');
    }
  });

  it('loads new relief material inside a chat ShadowRoot without styling the host', async function () {
    await verifyShadowRootMaterial('neumorphism');
  });

  it('switches immediately without a transition marker when motion is reduced', function () {
    const original = getPref('chat.skin');
    const doc = Zotero.getMainWindow().document;
    const root = htmlElement(doc, 'div');
    const view = doc.defaultView!;
    const matchMedia = view.matchMedia;
    doc.documentElement.appendChild(root);
    try {
      view.matchMedia = (query: string) =>
        query === '(prefers-reduced-motion: reduce)' ? ({ matches: true } as MediaQueryList) : matchMedia.call(view, query);
      setPref('chat.skin', 'paper');
      registerChatSkinRoot(root);
      setPref('chat.skin', 'neumorphism');
      refreshChatSkin();
      assert.equal(root.getAttribute('data-zaibar-skin'), 'neumorphism');
      assert.isFalse(root.hasAttribute('data-zaibar-skin-transition'));
    } finally {
      view.matchMedia = matchMedia;
      stopChatSkinSync();
      root.remove();
      setPref('chat.skin', original || 'rose');
    }
  });
});

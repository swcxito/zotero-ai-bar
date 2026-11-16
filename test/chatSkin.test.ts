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
  const screenshot = htmlElement(doc, 'button', 'input-screenshot-btn') as HTMLButtonElement;
  const thinking = htmlElement(doc, 'button', 'input-thinking-btn');
  const sideButton = htmlElement(doc, 'button', 'zaibar-sidepane-btn');
  const readerButton = htmlElement(doc, 'button', 'ai-btn');
  const promptRow = htmlElement(doc, 'div', 'prompt-row');
  const selectedMenuItem = htmlElement(doc, 'div', 'model-dropdown-item selected');
  const previewControls = htmlElement(doc, 'div', 'zaibar-skin-preview-controls');
  const previewButton = htmlElement(doc, 'button');
  previewControls.appendChild(previewButton);
  const connectionPanel = htmlElement(doc, 'div', 'provider-card');
  const connectionButton = htmlElement(doc, 'button');
  connectionPanel.appendChild(connectionButton);
  input.appendChild(textarea);
  root.append(input, tool, screenshot, thinking, sideButton, readerButton, promptRow, selectedMenuItem, previewControls, connectionPanel);
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
    for (const node of [screenshot, thinking, sideButton, readerButton, promptRow, previewButton, connectionPanel, connectionButton]) {
      assert.notEqual(computed(node).boxShadow, 'none', node.className || 'preview button');
    }
    assert.include(computed(selectedMenuItem).boxShadow, 'inset');
    // Check settled styles independently of the window's animation frame timing.
    for (const node of [screenshot, input, thinking]) node.style.setProperty('transition', 'none', 'important');
    screenshot.disabled = true;
    assert.equal(computed(screenshot).boxShadow, 'none');
    setPref('chat.skin', 'rose');
    refreshChatSkin();
    assert.notInclude(computed(input).boxShadow, 'inset');
    assert.equal(computed(thinking).boxShadow, 'none');
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

  it('keeps Abyss picker rows flush and adds relief on hover or keyboard focus', async function () {
    const original = getPref('chat.skin');
    const doc = Zotero.getMainWindow().document;
    const host = htmlElement(doc, 'div');
    const shadow = host.attachShadow({ mode: 'open' });
    const root = htmlElement(doc, 'div', 'bg-white');
    const pickers = ['add-provider-list', 'model-select-list', 'add-provider-custom'].map((id) => {
      const element = htmlElement(doc, 'div');
      element.id = id;
      element.style.display = 'flex';
      element.style.flexDirection = 'column';
      element.append(htmlElement(doc, 'button'), htmlElement(doc, 'button'));
      return element;
    });
    root.append(...pickers);
    shadow.appendChild(root);
    doc.documentElement.appendChild(host);
    try {
      await loadSkinStyles(doc, shadow);
      setPref('chat.skin', 'neumorphism');
      registerChatSkinRoot(root);
      const { InspectorUtils } = doc.defaultView!;
      for (const picker of pickers) {
        const [first, second] = Array.from(picker.children);
        assert.equal(computed(first).borderTopWidth, '0px');
        assert.equal(computed(first).backgroundColor, 'rgba(0, 0, 0, 0)');
        assert.equal(computed(first).boxShadow, 'none');
        assert.closeTo(first.getBoundingClientRect().bottom, second.getBoundingClientRect().top, 0.01);
        for (const pseudo of [':hover', ':focus-visible']) {
          InspectorUtils.addPseudoClassLock(first, pseudo);
          try {
            assert.notEqual(computed(first).backgroundColor, computed(second).backgroundColor);
            assert.notEqual(computed(first).boxShadow, 'none');
            assert.closeTo(first.getBoundingClientRect().bottom, second.getBoundingClientRect().top, 0.01);
          } finally {
            InspectorUtils.removePseudoClassLock(first, pseudo);
          }
        }
      }
    } finally {
      host.remove();
      setPref('chat.skin', original || 'rose');
    }
  });

  it('styles the outer side pane in the Zotero main document', async function () {
    const original = getPref('chat.skin');
    const doc = Zotero.getMainWindow().document;
    assert.isNotNull(doc.querySelector('link[href="chrome://zaibar/content/styles/skins.css"]'));
    const pane = doc.createXULElement('vbox');
    pane.id = 'zaibar-sidepane';
    const button = htmlElement(doc, 'button', 'zaibar-sidepane-btn');
    pane.appendChild(button);
    doc.documentElement.appendChild(pane);
    try {
      setPref('chat.skin', 'neumorphism');
      registerChatSkinRoot(pane);
      assert.equal(computed(pane).getPropertyValue('--page').trim(), expectedPage(doc, 'neumorphism'));
      assert.notEqual(computed(button).boxShadow, 'none');
      button.style.setProperty('transition', 'none', 'important');
      setPref('chat.skin', 'rose');
      refreshChatSkin();
      assert.equal(computed(button).boxShadow, 'none');
    } finally {
      stopChatSkinSync();
      pane.remove();
      setPref('chat.skin', original || 'rose');
    }
  });

  it('keeps native preferences backgrounds and controls free of chat skin decoration', async function () {
    const original = getPref('chat.skin');
    const doc = Zotero.getMainWindow().document;
    const root = doc.createXULElement('groupbox');
    root.id = 'zaibar-prefs-root';
    const section = doc.createXULElement('groupbox');
    const button = doc.createXULElement('button');
    section.appendChild(button);
    root.appendChild(section);
    doc.documentElement.appendChild(root);
    let link: HTMLLinkElement | undefined;
    try {
      link = await loadSkinStyles(doc, doc.documentElement);
      const nativeNodes = [root, section, button];
      for (const node of nativeNodes) node.style.setProperty('transition', 'none', 'important');
      const decorations = () =>
        nativeNodes.map((node) => {
          const { boxShadow, backgroundImage, backgroundColor } = computed(node);
          return { boxShadow, backgroundImage, backgroundColor };
        });
      // Native control styling varies with the Zotero version, OS and theme.
      const baseline = decorations();
      setPref('chat.skin', 'neumorphism');
      registerChatSkinRoot(root);
      assert.deepEqual(decorations(), baseline);
      assert.equal(computed(doc.documentElement).getPropertyValue('--za-neu-inset').trim(), '');
      setPref('chat.skin', 'rose');
      refreshChatSkin();
      assert.deepEqual(decorations(), baseline);
    } finally {
      stopChatSkinSync();
      link?.remove();
      root.remove();
      setPref('chat.skin', original || 'rose');
    }
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

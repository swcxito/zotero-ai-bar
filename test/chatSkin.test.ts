import { assert } from 'chai';
import { CHAT_SKINS, normalizeChatSkin, registerChatSkinRoot, startChatSkinSync, stopChatSkinSync } from '../src/utils/chatSkin';
import { getPref, setPref } from '../src/utils/prefs';

describe('chat skins', function () {
  it('keeps six stable IDs and falls back to Rose for invalid preferences', function () {
    assert.deepEqual(CHAT_SKINS, ['rose', 'paper', 'abyss', 'moss', 'tactical', 'bw']);
    assert.equal(normalizeChatSkin('paper'), 'paper');
    assert.equal(normalizeChatSkin('unknown'), 'rose');
    assert.equal(normalizeChatSkin(undefined), 'rose');
  });

  it('updates an open plugin root when the preference changes', async function () {
    const original = getPref('chat.skin');
    const root = Zotero.getMainWindow().document.createElement('div');
    try {
      startChatSkinSync();
      setPref('chat.skin', 'paper');
      registerChatSkinRoot(root);
      Zotero.getMainWindow().document.documentElement.appendChild(root);
      assert.equal(root.getAttribute('data-zaibar-skin'), 'paper');
      assert.include(['#fdf9f3', '#26292b'], root.ownerDocument.defaultView!.getComputedStyle(root).getPropertyValue('--page').trim());
      setPref('chat.skin', 'moss');
      await new Promise<void>((resolve) => root.ownerDocument.defaultView!.setTimeout(resolve, 10));
      assert.equal(root.getAttribute('data-zaibar-skin'), 'moss');
    } finally {
      stopChatSkinSync();
      root.remove();
      setPref('chat.skin', original || 'rose');
    }
  });

  it('loads the selected palette inside a chat ShadowRoot', async function () {
    const original = getPref('chat.skin');
    const doc = Zotero.getMainWindow().document;
    const host = doc.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'chrome://zaibar/content/styles/skins.css';
    const content = doc.createElement('div');
    try {
      setPref('chat.skin', 'abyss');
      registerChatSkinRoot(content);
      shadow.append(link, content);
      doc.documentElement.appendChild(host);
      await new Promise<void>((resolve) => {
        if (link.sheet) return resolve();
        link.addEventListener('load', () => resolve(), { once: true });
        doc.defaultView!.setTimeout(resolve, 300);
      });
      assert.include(['#f2f7fc', '#071426'], doc.defaultView!.getComputedStyle(content).getPropertyValue('--page').trim());
    } finally {
      host.remove();
      setPref('chat.skin', original || 'rose');
    }
  });
});

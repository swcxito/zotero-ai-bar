import { assert } from 'chai';
import {
  GLOBAL_AGENT_SESSION_ID,
  getArticleSessionId,
  getSessionId,
  getSessionKind,
  getTranslationSessionId,
  getTranslationRoute,
  getWorkspaceSnapshot,
  hideTranslationWorkspace,
  removeWorkspaceSource,
  selectWorkspaceKind,
  setSeparateTranslationEnabled,
  showTranslationWorkspace,
  updateSelectedZoteroTab,
} from '../src/modules/chatWorkspace';

describe('chatWorkspace', function () {
  const sourceA = 'test-reader-a';
  const sourceB = 'test-reader-b';

  afterEach(function () {
    updateSelectedZoteroTab(sourceA, true);
    selectWorkspaceKind('article', sourceA);
    removeWorkspaceSource(sourceA);
    removeWorkspaceSource(sourceB);
    updateSelectedZoteroTab('zotero-pane', false);
  });

  it('creates stable session IDs for every workspace kind', function () {
    assert.equal(getArticleSessionId(sourceA), `article:${sourceA}`);
    assert.equal(getTranslationSessionId(sourceA), `translation:${sourceA}`);
    assert.equal(getSessionId('global-agent'), GLOBAL_AGENT_SESSION_ID);
    assert.equal(getSessionKind(getArticleSessionId(sourceA)), 'article');
    assert.equal(getSessionKind(getTranslationSessionId(sourceA)), 'translation');
    assert.equal(getSessionKind(GLOBAL_AGENT_SESSION_ID), 'global-agent');
  });

  it('routes translation to the article or dedicated session based on the preference', function () {
    assert.deepEqual(getTranslationRoute(sourceA, false), {
      sessionId: getArticleSessionId(sourceA),
      sessionKind: 'article',
    });
    assert.deepEqual(getTranslationRoute(sourceA, true), {
      sessionId: getTranslationSessionId(sourceA),
      sessionKind: 'translation',
    });
  });

  it('shows only Agent in the sidebar home while the window keeps the last article', function () {
    updateSelectedZoteroTab(sourceA, true);
    showTranslationWorkspace(sourceA);
    updateSelectedZoteroTab('zotero-pane', false);

    const sidebar = getWorkspaceSnapshot('sidebar');
    const standalone = getWorkspaceSnapshot('window');
    assert.equal(sidebar.activeKind, 'global-agent');
    assert.isUndefined(sidebar.sourceTabId);
    assert.equal(standalone.sourceTabId, sourceA);
    assert.equal(standalone.activeKind, 'translation');
  });

  it('shares the article/global workspace selection across all articles', function () {
    updateSelectedZoteroTab(sourceA, true);
    selectWorkspaceKind('global-agent', sourceA);
    updateSelectedZoteroTab(sourceB, true);
    assert.equal(getWorkspaceSnapshot('sidebar').activeKind, 'global-agent');

    selectWorkspaceKind('article', sourceB);
    updateSelectedZoteroTab(sourceA, true);
    assert.equal(getWorkspaceSnapshot('sidebar').activeKind, 'article');
    updateSelectedZoteroTab(sourceB, true);
    assert.equal(getWorkspaceSnapshot('sidebar').activeKind, 'article');
  });

  it('hides translation without deleting its session identity', function () {
    updateSelectedZoteroTab(sourceA, true);
    showTranslationWorkspace(sourceA);
    hideTranslationWorkspace(sourceA);
    const snapshot = getWorkspaceSnapshot('sidebar');
    assert.isFalse(snapshot.translationVisible);
    assert.equal(snapshot.activeKind, 'article');
    assert.equal(getTranslationSessionId(sourceA), `translation:${sourceA}`);
  });

  it('hides all translation tabs when separate translation is disabled', function () {
    updateSelectedZoteroTab(sourceA, true);
    showTranslationWorkspace(sourceA);
    setSeparateTranslationEnabled(false);
    const snapshot = getWorkspaceSnapshot('sidebar');
    assert.isFalse(snapshot.translationVisible);
    assert.equal(snapshot.activeKind, 'article');
  });
});

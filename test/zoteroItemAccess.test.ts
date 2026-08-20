import { assert } from 'chai';
import { buildLibraryTree, isValidTreeItem } from '../src/utils/zoteroItemAccess';

function item(fields: Record<string, string>, options: { regular?: boolean; attachment?: boolean; note?: boolean; annotation?: boolean } = {}) {
  return {
    isRegularItem: () => options.regular ?? true,
    isAttachment: () => options.attachment ?? false,
    isNote: () => options.note ?? false,
    isAnnotation: () => options.annotation ?? false,
    getField: (name: string) => fields[name] ?? '',
    getCreators: () => [],
  };
}

describe('tree helpers', function () {
  it('keeps only regular literature with useful metadata', function () {
    assert.isTrue(isValidTreeItem(item({ title: 'Useful paper' })));
    assert.isFalse(isValidTreeItem(item({})));
    assert.isFalse(isValidTreeItem(item({ title: 'PDF' }, { attachment: true })));
    assert.isFalse(isValidTreeItem(item({ title: 'Note' }, { note: true })));
    assert.isFalse(isValidTreeItem(item({ title: 'Annotation' }, { annotation: true })));
  });

  describe('library tree roots', function () {
    it('includes direct items when a collection is used as the root', async function () {
      const globalScope = globalThis as any;
      const originalZotero = globalScope.Zotero;
      const originalZtoolkit = globalScope.ztoolkit;

      const directItem = item({ title: 'Direct item' }) as any;
      directItem.id = 11;
      directItem.itemTypeID = 1;

      const childItem = item({ title: 'Nested item' }) as any;
      childItem.id = 12;
      childItem.itemTypeID = 1;

      const rootCollection = {
        id: 1,
        key: 'ROOT',
        name: 'Parent',
        getChildItems: () => [directItem],
      };
      const childCollection = {
        id: 2,
        key: 'CHILD',
        name: 'Child',
        getChildItems: () => [childItem],
      };

      globalScope.Zotero = {
        Libraries: { userLibraryID: 1, get: () => ({ name: 'My Library' }) },
        Collections: {
          getByLibrary: () => [rootCollection],
          getByParent: (id: number) => (id === 1 ? [childCollection] : []),
          get: (id: number) => (id === 1 ? rootCollection : childCollection),
        },
        Items: { getAll: () => [] },
        ItemTypes: { getName: () => 'journalArticle' },
      };
      globalScope.ztoolkit = { log: () => undefined };

      try {
        const result = await buildLibraryTree({ rootCollectionPath: ['Parent'], depth: 2, includeItems: true });
        assert.isString(result);
        assert.include(result as string, 'Direct item');
        assert.include(result as string, 'Nested item');
      } finally {
        globalScope.Zotero = originalZotero;
        globalScope.ztoolkit = originalZtoolkit;
      }
    });
  });
});

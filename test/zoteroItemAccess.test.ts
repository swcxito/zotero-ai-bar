import { assert } from 'chai';
import { buildLibraryTree, getSelectedLibraryItems, isValidTreeItem } from '../src/utils/zoteroItemAccess';
import { getSelectedItemsSchema } from '../src/utils/agentSchemas';

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

describe('Zotero item access', function () {
  describe('selected library items', function () {
    const scope = globalThis as any;
    let originalZotero: any;
    let originalZtoolkit: any;
    let selection: any[];
    let stored: Map<number, any>;

    beforeEach(function () {
      originalZotero = scope.Zotero;
      originalZtoolkit = scope.ztoolkit;
      selection = [];
      stored = new Map();
      scope.Zotero = {
        getMainWindow: () => ({ ZoteroPane: { itemsView: { getSelectedItems: () => selection } } }),
        Items: { get: (id: number) => stored.get(id) },
        ItemTypes: { getName: () => 'journalArticle', getLocalizedString: () => 'Journal Article' },
      };
      scope.ztoolkit = { log: () => undefined };
    });

    afterEach(function () {
      scope.Zotero = originalZotero;
      scope.ztoolkit = originalZtoolkit;
    });

    function paper(id: number) {
      const entry = { ...item({ title: `Paper ${id}`, abstractNote: 'An abstract', date: '2026' }), id, key: `KEY${id}`, itemTypeID: 1 };
      stored.set(id, entry);
      return entry;
    }

    it('returns metadata and reads the current selection again on each call', function () {
      selection = [paper(1)];
      const result = getSelectedLibraryItems();
      assert.equal(result.items[0].itemId, 1);
      assert.equal(result.items[0].abstract, 'An abstract');
      assert.equal(result.items[0].publicationDate, '2026');
      selection = [paper(2)];
      assert.equal(getSelectedLibraryItems().items[0].itemId, 2);
    });

    it('resolves child attachments, deduplicates parents and lists attachment choices', function () {
      const parent = { ...paper(1), getAttachments: () => [2, 3] };
      stored.set(1, parent);
      const attachment = { ...item({ title: 'PDF' }, { regular: false, attachment: true }), id: 2, parentID: 1 };
      stored.set(2, attachment);
      stored.set(3, { ...attachment, id: 3 });
      selection = [attachment, parent];
      const result = getSelectedLibraryItems();
      assert.equal(result.total, 1);
      assert.equal(result.selectedCount, 2);
      assert.equal(result.items[0].itemId, 1);
      assert.deepEqual(
        result.items[0].attachments?.map((entry) => entry.id),
        [2, 3]
      );
    });

    it('keeps standalone attachments readable and skips notes, annotations and deleted items', function () {
      const attachment = { ...item({ title: 'Standalone PDF' }, { regular: false, attachment: true }), id: 2 };
      stored.set(2, attachment);
      selection = [attachment, item({ title: 'Note' }, { note: true }), item({}, { annotation: true }), { ...paper(3), deleted: true }];
      assert.deepEqual(
        getSelectedLibraryItems().items.map((entry) => entry.itemId),
        [2]
      );
    });

    it('returns an explicit empty result and reports an unavailable pane', function () {
      assert.deepEqual(getSelectedLibraryItems(), { items: [], selectedCount: 0, total: 0, truncated: false, nextOffset: undefined, remaining: 0 });
      scope.Zotero.getMainWindow = () => undefined;
      assert.throws(() => getSelectedLibraryItems(), /library pane is unavailable/);
    });

    it('paginates multiple selections without dropping items', function () {
      selection = Array.from({ length: 23 }, (_, index) => paper(index + 1));
      const first = getSelectedLibraryItems();
      assert.lengthOf(first.items, 20);
      assert.equal(first.nextOffset, 20);
      assert.equal(first.remaining, 3);
      const last = getSelectedLibraryItems({ offset: first.nextOffset });
      assert.deepEqual(
        last.items.map((entry) => entry.itemId),
        [21, 22, 23]
      );
      assert.isFalse(last.truncated);
      assert.isUndefined(last.nextOffset);
    });

    it('validates pagination bounds and defaults', function () {
      assert.deepEqual(getSelectedItemsSchema.parse({}), { offset: 0, limit: 20 });
      for (const input of [{ offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 51 }]) {
        assert.isFalse(getSelectedItemsSchema.safeParse(input).success);
      }
    });
  });

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
});

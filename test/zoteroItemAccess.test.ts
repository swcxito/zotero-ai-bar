import { assert } from 'chai';
import { isValidTreeItem } from '../src/utils/zoteroItemAccess';

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

describe('tree item filtering', function () {
  it('keeps only regular literature with useful metadata', function () {
    assert.isTrue(isValidTreeItem(item({ title: 'Useful paper' })));
    assert.isFalse(isValidTreeItem(item({})));
    assert.isFalse(isValidTreeItem(item({ title: 'PDF' }, { attachment: true })));
    assert.isFalse(isValidTreeItem(item({ title: 'Note' }, { note: true })));
    assert.isFalse(isValidTreeItem(item({ title: 'Annotation' }, { annotation: true })));
  });
});

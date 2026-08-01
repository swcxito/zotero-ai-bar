import { assert } from 'chai';
import { buildDocumentSnapshot, createDocumentFingerprint } from '../src/utils/documentSnapshot';

describe('documentSnapshot', function () {
  it('is deterministic and independent of the current question', function () {
    const text = Array.from({ length: 20 }, (_, index) => `SECTION ${index}\nPage ${index} content.\f`).join('');
    const first = buildDocumentSnapshot(text, { title: 'Paper', abstract: 'Summary' }, 3000);
    const second = buildDocumentSnapshot(text, { title: 'Paper', abstract: 'Summary' }, 3000);
    assert.equal(first, second);
    assert.include(first, 'Uniform page sample');
    assert.equal(createDocumentFingerprint(text), createDocumentFingerprint(text));
  });
});

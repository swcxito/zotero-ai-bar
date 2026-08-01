import { assert } from 'chai';
import { grepInTextPaginated } from '../src/utils/textSearch';
import { formatLinesLimited } from '../src/utils/zoteroItemAccess';

describe('Agent tool pagination limits', function () {
  it('paginates grep results with exact continuation metadata', function () {
    const text = Array.from({ length: 120 }, (_, index) => `match ${index}`).join('\n');
    const first = grepInTextPaginated(text, 'match', false, 50, 0);
    assert.lengthOf(first.excerpts, 50);
    assert.equal(first.totalMatches, 120);
    assert.equal(first.nextOffset, 50);
    assert.equal(first.remaining, 70);
    const last = grepInTextPaginated(text, 'match', false, 50, 100);
    assert.lengthOf(last.excerpts, 20);
    assert.isFalse(last.truncated);
  });

  it('caps excerpts and aggregate grep output', function () {
    const text = Array.from({ length: 500 }, () => `hit ${'x'.repeat(3000)}`).join('\n');
    const page = grepInTextPaginated(text, 'hit', false, 500, 0);
    assert.isAtMost(page.excerpts[0].excerpt.length, 2000);
    assert.isAtMost(
      page.excerpts.reduce((total, match) => total + match.excerpt.length, 0),
      250000
    );
    assert.isTrue(page.truncated);
  });

  it('caps read output by both lines and characters and exposes the continuation boundary', function () {
    const manyLines = Array.from({ length: 6000 }, (_, index) => `line ${index}`);
    const lineCapped = formatLinesLimited(manyLines, 0, manyLines.length);
    assert.equal(lineCapped.end, 5000);
    assert.isTrue(lineCapped.truncated);
    const largeLines = Array.from({ length: 1000 }, () => 'x'.repeat(1000));
    const charCapped = formatLinesLimited(largeLines, 0, largeLines.length);
    assert.isBelow(charCapped.text.length, 250001);
    assert.isTrue(charCapped.truncated);
    assert.isAbove(charCapped.end, 0);
  });
});

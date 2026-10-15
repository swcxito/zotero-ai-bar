import { assert } from 'chai';
import { createMarkdownRenderCache } from '../src/utils/markdownRenderCache';

describe('Markdown render cache', function () {
  it('keeps math and code separate, refreshes recency, and limits each kind to 128 entries', function () {
    const cache = createMarkdownRenderCache();
    let calls = 0;
    const get = (kind: 'math' | 'code', key: string) => cache.getOrRender(kind, key, () => String(++calls));
    const first = get('math', '0');
    assert.notEqual(get('code', '0'), first);
    for (let i = 1; i < 128; i++) get('math', String(i));
    assert.equal(get('math', '0'), first);
    get('math', '128');
    assert.equal(get('math', '0'), first);
    const before = calls;
    get('math', '1');
    assert.equal(calls, before + 1, 'The least recently used math entry was evicted');
    assert.equal(get('code', '0'), '2', 'The code entry survived the math entry limit');
  });

  it('shares its character budget across kinds and does not retain oversized entries', function () {
    const cache = createMarkdownRenderCache();
    let calls = 0;
    const get = (kind: 'math' | 'code', key: string, size: number) =>
      cache.getOrRender(kind, key, () => {
        calls++;
        return 'x'.repeat(size);
      });
    get('math', 'formula', 600_000);
    get('code', 'source', 600_000);
    get('math', 'formula', 600_000);
    assert.equal(calls, 3, 'The combined budget evicts entries across kinds');
    get('code', 'huge', 1_000_001);
    get('code', 'huge', 1_000_001);
    assert.equal(calls, 5);
    const another = createMarkdownRenderCache();
    assert.equal(
      another.getOrRender('math', 'formula', () => 'fresh'),
      'fresh'
    );
  });
});

import { assert } from 'chai';
import { nativeLiteratureRequest, searchCrossrefPapers } from '../../src/modules/literatureTools';

describe('native literature HTTP with loopback fixtures', function () {
  let origin: string;

  before(function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    origin = Services.env.get('ZAIBAR_TEST_HTTP_ORIGIN');
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('times out a response whose headers arrive but whose body stalls', async function () {
    let error: unknown;
    try {
      await nativeLiteratureRequest(`${origin}/stalled`, { timeoutMs: 150 });
    } catch (caught) {
      error = caught;
    }
    assert.exists(error, 'the timeout must cover the response body');
  });

  it('makes exactly two attempts after a whole-response timeout', async function () {
    let attempts = 0;
    const result = await searchCrossrefPapers(
      { title: 'Synthetic local fixture' },
      {
        timeoutMs: 500,
        delay: async () => {},
        requestImpl: async (_url, options) => {
          attempts++;
          const response = await nativeLiteratureRequest(`${origin}/retry`, options);
          const payload = (await response.json()) as any;
          assert.equal(payload.attempts, 2, 'native HTTP must not add implicit retries');
          return { ...response, json: async () => payload };
        },
      }
    );
    assert.equal(attempts, 2);
    assert.isEmpty(result.candidates);
  });

  it('actively cancels a stalled request without retrying', async function () {
    let attempts = 0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    let error: any;
    try {
      await searchCrossrefPapers(
        { title: 'Synthetic local fixture' },
        {
          signal: controller.signal,
          requestImpl: (_url, options) => {
            attempts++;
            return nativeLiteratureRequest(`${origin}/cancel`, options);
          },
        }
      );
    } catch (caught) {
      error = caught;
    } finally {
      clearTimeout(timer);
    }
    assert.equal(error?.name, 'AbortError');
    assert.equal(attempts, 1);
  });
});

import { assert } from 'chai';
import { appListFailureReason, appThreadPolicy, parseApps, listApps, selectApp, selectedAppIds, visibleApps } from '../../src/modules/codex/apps';
import { formFields, handleElicitation, elicitationUrl } from '../../src/modules/codex/elicitation';

describe('Codex apps', function () {
  it('disables inherited apps and enables only the selected IDs', function () {
    const config = { apps: { notion: { enabled: true }, gmail: { enabled: true }, _default: { enabled: true } } };
    const policy = appThreadPolicy(config, ['notion']);
    assert.isTrue(policy['apps.notion.enabled']);
    assert.isFalse(policy['apps.gmail.enabled']);
    assert.isFalse(policy['apps._default.enabled']);
    assert.isTrue(config.apps.gmail.enabled, 'Shared config is not mutated');
    assert.isFalse(appThreadPolicy(config, [])['features.apps']);
    assert.throws(() => appThreadPolicy({ apps: { 'bad.id': {} } }, []));
    assert.throws(() => appThreadPolicy({ apps: [] }, []));
  });

  it('scopes selections to the account and survives invalid preferences', function () {
    let pref = 'broken';
    Object.assign(globalThis, {
      Zotero: {
        Prefs: {
          get: () => pref,
          set: (_: string, v: string) => {
            pref = v;
          },
        },
      },
    });
    assert.deepEqual(selectedAppIds('a'), []);
    selectApp('a', 'notion', true);
    assert.deepEqual(selectedAppIds('a'), ['notion']);
    assert.deepEqual(selectedAppIds('b'), []);
    selectApp('a', 'notion', false);
    assert.deepEqual(selectedAppIds('a'), []);
  });

  it('validates catalog entries and paginates without duplicating apps', async function () {
    const app = { id: 'notion', name: 'Notion', isAccessible: true, isEnabled: false, installUrl: 'javascript:alert(1)' };
    assert.isUndefined(parseApps([app])[0].installUrl);
    // An unsafe row is never selectable, and does not hide the rest of a catalog of thousands.
    assert.deepEqual(
      parseApps([{ ...app, id: 'unsafe.key' }, null, { id: 'x' }, app]).map((entry) => entry.id),
      ['notion']
    );
    assert.throws(() => parseApps({ data: [app] }));
    const calls: any[] = [];
    const rpc: any = {
      request: async (_: string, params: any) => {
        calls.push(params);
        return { data: [app], nextCursor: calls.length === 1 ? 'second' : null };
      },
    };
    assert.lengthOf(await listApps(rpc, true), 1);
    assert.isTrue(calls[0].forceRefetch);
    assert.isFalse(calls[1].forceRefetch);
    let failure: unknown;
    try {
      await listApps({ request: async () => ({ data: [app], nextCursor: 'repeat' }) } as any);
    } catch (error) {
      failure = error;
    }
    assert.instanceOf(failure, Error);
  });

  it('lists connected and selected apps only, and explains a blocked app directory', function () {
    const apps = parseApps([
      { id: 'zeta', name: 'Zeta', isAccessible: true },
      { id: 'dir_1', name: 'Directory app', isAccessible: false },
      { id: 'gone', name: 'Was connected', isAccessible: false },
      { id: 'alpha', name: 'Alpha', isAccessible: true },
    ]);
    // Sorted by name; the unconnected directory entry is hidden, the formerly connected selection stays.
    assert.deepEqual(
      visibleApps(apps, ['gone']).map((app) => app.name),
      ['Alpha', 'Was connected', 'Zeta']
    );
    // Error text returned by codex-cli 0.166 when chatgpt.com answers app/list with a browser challenge.
    const blocked = Object.assign(new Error('Codex -32603'), {
      rpcError: {
        code: -32603,
        message: 'failed to list apps: Request failed with status 403 Forbidden: <html><body>Enable JavaScript and cookies to continue</body></html>',
      },
    });
    assert.equal(appListFailureReason(blocked), 'HTTP 403, browser verification');
    assert.equal(appListFailureReason({ rpcError: { message: 'failed to list apps: Request failed with status 502 Bad Gateway' } }), 'HTTP 502');
    assert.equal(appListFailureReason(new Error('timeout')), '');
  });

  it('validates typed form constraints, enum titles and arrays', async function () {
    const params = {
      mode: 'form',
      serverName: 'Notion',
      message: 'Update page',
      requestedSchema: {
        type: 'object',
        required: ['choice', 'count', 'tags'],
        properties: {
          choice: {
            type: 'string',
            oneOf: [
              { const: 'yes', title: 'Approve' },
              { const: 'no', title: 'Decline' },
            ],
          },
          count: { type: 'integer', minimum: 1, maximum: 3 },
          tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] }, minItems: 1 },
        },
      },
    };
    const answers = [{ selectedOptions: ['Approve (yes)'] }, { selectedOptions: [], customInput: '2' }, { selectedOptions: ['a', 'b'] }];
    const result = await handleElicitation(
      params,
      async () => [answers.shift() as any],
      () => true,
      () => {}
    );
    assert.deepEqual(result.content, { choice: 'yes', count: 2, tags: ['a', 'b'] });
    const fields = formFields(params.requestedSchema);
    assert.throws(() => fields[1][2].parse(2.5));
    assert.throws(() => fields[1][2].parse(4));
    assert.throws(() => fields[2][2].parse(['a', 'a']));
    assert.throws(() => formFields({ type: 'object', properties: { nested: { type: 'object' } } }));
  });

  it('does not infer approval from defaults or cancellation', async function () {
    let active = true;
    const result = await handleElicitation(
      { mode: 'form', requestedSchema: { type: 'object', properties: { approved: { type: 'boolean', default: true } }, required: ['approved'] } },
      async () => {
        active = false;
        return [{ selectedOptions: ['true'] } as any];
      },
      () => active,
      () => {}
    );
    assert.equal(result.action, 'cancel');
    assert.isNull(result.content);
  });

  it('opens authorization URLs only after user consent and waits for completion', async function () {
    assert.throws(() => elicitationUrl('file:///secret'));
    assert.throws(() => elicitationUrl('https://name:password@example.org'));
    let opened = 0;
    let asked = 0;
    const result = await handleElicitation(
      { mode: 'url', serverName: 'Notion', message: 'Connect', url: 'https://example.org/auth' },
      async (payload) => {
        asked++;
        assert.equal(opened, asked === 1 ? 0 : 1);
        return [{ selectedOptions: [payload.questions[0].options![0].label] } as any];
      },
      () => true,
      () => {
        opened++;
      }
    );
    assert.equal(asked, 2);
    assert.equal(result.action, 'accept');
    await handleElicitation(
      { mode: 'url', url: 'https://example.org/auth' },
      async (payload) => [{ selectedOptions: [payload.questions[0].options![1].label] } as any],
      () => true,
      () => {
        opened++;
      }
    );
    assert.equal(opened, 1);
  });
});

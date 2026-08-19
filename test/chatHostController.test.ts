import { assert } from 'chai';
import { createChatHostController, type ChatHostControllerDependencies } from '../src/modules/chatHostController';
import type { ChatHostMode } from '../src/modules/chatManager';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('chatHostController', function () {
  function setup(overrides: Partial<ChatHostControllerDependencies> = {}) {
    let mode: ChatHostMode = 'sidebar';
    const events: string[] = [];
    const deps: ChatHostControllerDependencies = {
      getMode: () => mode,
      hasActiveRequests: () => false,
      activate: async (target) => {
        events.push(`activate:${target}`);
      },
      deactivate: async (target) => {
        events.push(`deactivate:${target}`);
      },
      commitMode: async (target) => {
        events.push(`commit:${target}`);
        mode = target;
      },
      refresh: async () => {
        events.push('refresh');
      },
      ...overrides,
    };
    return { controller: createChatHostController(deps), events, getMode: () => mode };
  }

  it('switches hosts in teardown, mount, commit order', async function () {
    const { controller, events, getMode } = setup();

    assert.isTrue(await controller.switchChatHost('window'));
    assert.equal(getMode(), 'window');
    assert.deepEqual(events, ['deactivate:sidebar', 'activate:window', 'commit:window', 'refresh']);
  });

  it('blocks switching while a request is active', async function () {
    const { controller, events } = setup({ hasActiveRequests: () => true });

    assert.isFalse(await controller.switchChatHost('window'));
    assert.isTrue(controller.isBlocked());
    assert.deepEqual(events, []);
  });

  it('coalesces repeated clicks into one transition', async function () {
    const gate = deferred<void>();
    const { controller, events } = setup({
      activate: async (target) => {
        events.push(`activate:${target}`);
        await gate.promise;
      },
    });

    const first = controller.switchChatHost('window');
    const second = controller.switchChatHost('window');
    assert.strictEqual(second, first);
    assert.isTrue(controller.isSwitching());
    gate.resolve();
    assert.isTrue(await first);
    assert.equal(events.filter((event) => event === 'activate:window').length, 1);
  });

  it('restores the previous host when target activation fails', async function () {
    let mode: ChatHostMode = 'sidebar';
    const events: string[] = [];
    const controller = createChatHostController({
      getMode: () => mode,
      hasActiveRequests: () => false,
      deactivate: async (target) => {
        events.push(`deactivate:${target}`);
      },
      activate: async (target) => {
        events.push(`activate:${target}`);
        if (target === 'window') throw new Error('window failed');
      },
      commitMode: async (target) => {
        events.push(`commit:${target}`);
        mode = target;
      },
      refresh: async () => {
        events.push('refresh');
      },
    });

    assert.isFalse(await controller.switchChatHost('window'));
    assert.equal(mode, 'sidebar');
    assert.deepEqual(events, ['deactivate:sidebar', 'activate:window', 'deactivate:window', 'activate:sidebar', 'commit:sidebar', 'refresh']);
  });

  it('reactivates but does not recommit the current host', async function () {
    const { controller, events } = setup();

    assert.isTrue(await controller.switchChatHost('sidebar'));
    assert.deepEqual(events, ['activate:sidebar', 'refresh']);
  });
});

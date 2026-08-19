import { assert } from 'chai';
import { ChatWindowCloseCoordinator } from '../src/utils/chatWindowClose';

describe('chatWindowClose', function () {
  it('suppresses automatic recovery exactly once for a programmatic close', function () {
    const coordinator = new ChatWindowCloseCoordinator<object>();
    const window = {};

    coordinator.markProgrammatic(window);
    assert.isFalse(coordinator.shouldPrevent(window, true));
    assert.isTrue(coordinator.consumeProgrammatic(window));
    assert.isFalse(coordinator.consumeProgrammatic(window));
  });

  it('blocks native close only while a request is active', function () {
    const coordinator = new ChatWindowCloseCoordinator<object>();
    const window = {};

    assert.isTrue(coordinator.shouldPrevent(window, true));
    assert.isFalse(coordinator.shouldPrevent(window, false));
    assert.isFalse(coordinator.consumeProgrammatic(window));
  });
});

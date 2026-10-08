import { assert } from 'chai';
import { createStreamRenderer } from '../src/utils/streamRenderer';

function manualFrames() {
  const callbacks = new Set<() => void>();
  return {
    schedule(callback: () => void) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    run() {
      for (const callback of [...callbacks]) {
        callbacks.delete(callback);
        callback();
      }
    },
    callbacks,
  };
}

describe('stream renderer', function () {
  it('coalesces a burst and flushes the latest text without waiting for a frame', async function () {
    const frames = manualFrames();
    const rendered: string[] = [];
    const renderer = createStreamRenderer(async (text) => {
      rendered.push(text);
    }, frames.schedule);
    for (let i = 1; i <= 1000; i++) renderer.update('x'.repeat(i));
    assert.equal(frames.callbacks.size, 1);
    assert.isEmpty(rendered);
    await renderer.flush();
    assert.deepEqual(rendered, ['x'.repeat(1000)]);
    assert.equal(frames.callbacks.size, 0);
  });

  it('accepts new text during a slow render without creating a backlog', async function () {
    const frames = manualFrames();
    const rendered: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const renderer = createStreamRenderer(async (text) => {
      rendered.push(text);
      if (text === 'first') await blocked;
    }, frames.schedule);
    renderer.update('first');
    frames.run();
    await Promise.resolve();
    for (let i = 1; i <= 1000; i++) renderer.update(`next ${i}`);
    assert.deepEqual(rendered, ['first']);
    assert.equal(frames.callbacks.size, 0);
    release();
    await renderer.flush();
    assert.deepEqual(rendered, ['first', 'next 1000']);
    assert.equal(frames.callbacks.size, 0);
  });

  it('flushes a single-character tail and avoids redundant completed renders', async function () {
    const rendered: string[] = [];
    const frames = manualFrames();
    const renderer = createStreamRenderer(async (text) => {
      rendered.push(text);
    }, frames.schedule);
    await renderer.flush('答');
    await renderer.flush('答案');
    renderer.update('答案');
    await renderer.flush('答案');
    assert.deepEqual(rendered, ['答', '答案']);
  });

  it('cancels pending work on disposal and retains background render failures for flush', async function () {
    const frames = manualFrames();
    let calls = 0;
    const renderer = createStreamRenderer(async () => {
      calls++;
    }, frames.schedule);
    renderer.update('cancelled');
    renderer.dispose();
    frames.run();
    await renderer.flush();
    assert.equal(calls, 0);
    assert.equal(frames.callbacks.size, 0);

    const failure = new Error('render failed');
    const failingRenderer = createStreamRenderer(async () => {
      throw failure;
    }, frames.schedule);
    failingRenderer.update('text');
    frames.run();
    try {
      await failingRenderer.flush();
      assert.fail('Expected the render failure');
    } catch (error) {
      assert.strictEqual(error, failure);
    }
    failingRenderer.dispose();
    assert.equal(frames.callbacks.size, 0);
  });
});

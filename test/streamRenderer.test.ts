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
  it('adapts the period to render cost and measures it from the previous start', async function () {
    let time = 0;
    const frames = manualFrames();
    const delays: number[] = [];
    const renderer = createStreamRenderer(
      async () => {
        time += 30;
      },
      (callback, delay) => {
        delays.push(delay);
        return frames.schedule(callback);
      },
      () => time
    );
    renderer.update('first');
    assert.equal(delays.at(-1), 16);
    await renderer.flush();
    renderer.update('second');
    assert.equal(delays.at(-1), 30, '30ms work + 30ms wait = 60ms period');
    await renderer.flush();
    time += 100;
    renderer.update('third');
    assert.equal(delays.at(-1), 0, 'An idle renderer does not add another full period');
    await renderer.flush();
  });

  it('invalidates asynchronous commits when disposed during a render', async function () {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    let committed = false;
    const renderer = createStreamRenderer(async (_text, isCurrent) => {
      await blocked;
      if (isCurrent()) committed = true;
    });
    renderer.update('old reply');
    const flushed = renderer.flush();
    await Promise.resolve();
    renderer.dispose();
    release();
    await flushed;
    assert.isFalse(committed);
  });

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

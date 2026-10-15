/** Keep only the latest text while an asynchronous UI render is in flight. */
export function createStreamRenderer(
  render: (text: string, isCurrent: () => boolean) => Promise<void>,
  schedule: (callback: () => void, delay: number) => () => void = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
  now: () => number = () => globalThis.performance?.now() ?? Date.now()
) {
  let pendingText: string | undefined;
  let renderedText: string | undefined;
  let rendering: Promise<void> | undefined;
  let cancelScheduled: (() => void) | undefined;
  let disposed = false;
  let failed = false;
  let failure: unknown;
  let lastStart: number | undefined;
  let period = 16;

  function arm() {
    if (disposed || failed || rendering || cancelScheduled || pendingText === undefined) return;
    const delay = lastStart === undefined ? 16 : Math.max(0, period - (now() - lastStart));
    cancelScheduled = schedule(() => {
      cancelScheduled = undefined;
      startRender();
    }, delay);
  }

  function startRender() {
    if (disposed || failed || rendering || pendingText === undefined) return;
    const text = pendingText;
    pendingText = undefined;
    if (text === renderedText) return;
    lastStart = now();
    rendering = Promise.resolve()
      .then(() => {
        if (!disposed) return render(text, () => !disposed);
      })
      .then(() => {
        renderedText = text;
      })
      .catch((error: unknown) => {
        failed = true;
        failure = error;
        pendingText = undefined;
      })
      .finally(() => {
        period = Math.max(16, Math.min(80, (now() - lastStart!) * 2));
        rendering = undefined;
        arm();
      });
  }

  return {
    update(text: string) {
      if (disposed || failed) return;
      pendingText = text;
      arm();
    },
    /** Drain before a tool/reasoning boundary, stopping, or saving history. */
    async flush(text?: string) {
      if (disposed) return;
      if (text !== undefined && !failed) pendingText = text;
      while (rendering || pendingText !== undefined) {
        cancelScheduled?.();
        cancelScheduled = undefined;
        if (!rendering) startRender();
        if (rendering) await rendering;
      }
      cancelScheduled?.();
      cancelScheduled = undefined;
      if (failed) throw failure;
    },
    dispose() {
      disposed = true;
      pendingText = undefined;
      cancelScheduled?.();
      cancelScheduled = undefined;
    },
  };
}

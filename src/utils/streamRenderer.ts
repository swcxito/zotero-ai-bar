/** Keep only the latest text while an asynchronous UI render is in flight. */
export function createStreamRenderer(
  render: (text: string) => Promise<void>,
  schedule: (callback: () => void) => () => void = (callback) => {
    const timer = setTimeout(callback, 16);
    return () => clearTimeout(timer);
  }
) {
  let pendingText: string | undefined;
  let renderedText: string | undefined;
  let rendering: Promise<void> | undefined;
  let cancelScheduled: (() => void) | undefined;
  let disposed = false;
  let failed = false;
  let failure: unknown;

  function arm() {
    if (disposed || failed || rendering || cancelScheduled || pendingText === undefined) return;
    cancelScheduled = schedule(() => {
      cancelScheduled = undefined;
      startRender();
    });
  }

  function startRender() {
    if (disposed || failed || rendering || pendingText === undefined) return;
    const text = pendingText;
    pendingText = undefined;
    if (text === renderedText) return;
    rendering = Promise.resolve()
      .then(() => render(text))
      .then(() => {
        renderedText = text;
      })
      .catch((error: unknown) => {
        failed = true;
        failure = error;
        pendingText = undefined;
      })
      .finally(() => {
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

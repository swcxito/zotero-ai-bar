import { createStreamRenderer } from './streamRenderer';

/** Coalesce within a text item, serialize across text/reasoning/tool boundaries. */
export function createOrderedStreamRenderer(render: (key: string, text: string, isCurrent: () => boolean) => Promise<void>) {
  let queue = Promise.resolve();
  let disposed = false;
  let failure: unknown;
  let current: { key: string; text: string; ready: boolean; renderer: ReturnType<typeof createStreamRenderer> } | undefined;
  const renderers = new Set<ReturnType<typeof createStreamRenderer>>();
  function append(action: () => Promise<void> | void) {
    queue = queue.then(() => {
      if (!disposed) return action();
    });
    void queue.catch((error) => {
      failure = error;
    });
    return queue;
  }
  function boundary(action?: () => Promise<void> | void) {
    const segment = current;
    current = undefined;
    return append(async () => {
      if (segment) {
        await segment.renderer.flush(segment.text);
        segment.renderer.dispose();
        renderers.delete(segment.renderer);
      }
      if (!disposed) await action?.();
    });
  }
  return {
    update(key: string, text: string) {
      if (disposed) return;
      if (!current || current.key !== key) {
        boundary();
        const renderer = createStreamRenderer((value, isCurrent) => render(key, value, () => !disposed && isCurrent()));
        const segment = { key, text, renderer, ready: false };
        current = segment;
        renderers.add(renderer);
        append(() => {
          segment.ready = true;
          renderer.update(segment.text);
        });
      } else current.text = text;
      if (current.ready) current.renderer.update(text);
    },
    boundary,
    async flush() {
      await boundary();
      if (failure) throw failure;
    },
    dispose() {
      disposed = true;
      current = undefined;
      renderers.forEach((renderer) => renderer.dispose());
      renderers.clear();
    },
  };
}

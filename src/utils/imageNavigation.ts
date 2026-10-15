/** Shared navigation for overlay and standalone image viewers. */
export function createImageNavigation(
  count: number,
  start: number,
  render: (index: number, state: { counter: string; hasPrevious: boolean; hasNext: boolean }) => void,
  close: () => void
) {
  let index = Math.max(0, Math.min(Math.max(0, count - 1), start));
  function show(next: number) {
    index = Math.max(0, Math.min(Math.max(0, count - 1), next));
    if (count) render(index, { counter: `${index + 1} / ${count}`, hasPrevious: index > 0, hasNext: index < count - 1 });
  }
  const controller = {
    get index() {
      return index;
    },
    get hasPrevious() {
      return index > 0;
    },
    get hasNext() {
      return index < count - 1;
    },
    show,
    previous: () => show(index - 1),
    next: () => show(index + 1),
    key(key: string) {
      if (key === 'Escape') close();
      else if (key === 'ArrowLeft') controller.previous();
      else if (key === 'ArrowRight') controller.next();
    },
  };
  show(index);
  return controller;
}

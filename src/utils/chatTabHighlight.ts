const observers = new WeakMap<HTMLElement, ResizeObserver>();

function positionHighlight(tabs: HTMLElement): void {
  const active = tabs.querySelector<HTMLElement>(':scope > [data-active="true"]');
  if (!active) {
    tabs.dataset.highlightVisible = 'false';
    return;
  }

  const container = tabs.getBoundingClientRect();
  const target = active.getBoundingClientRect();
  if (!container.width || !target.width) return;

  tabs.style.setProperty('--zaibar-tab-x', `${target.left - container.left}px`);
  tabs.style.setProperty('--zaibar-tab-width', `${target.width}px`);
  tabs.style.setProperty('--zaibar-tab-height', `${target.height}px`);
  tabs.dataset.highlightVisible = 'true';
  if (tabs.dataset.highlightReady !== 'true') {
    tabs.ownerDocument.defaultView?.requestAnimationFrame(() => {
      if (tabs.isConnected) tabs.dataset.highlightReady = 'true';
    });
  }
}

export function syncChatTabHighlight(tabs: HTMLElement): void {
  positionHighlight(tabs);
  if (observers.has(tabs)) return;

  const ResizeObserverClass = tabs.ownerDocument.defaultView?.ResizeObserver;
  if (!ResizeObserverClass) return;
  const observer = new ResizeObserverClass(() => positionHighlight(tabs));
  observer.observe(tabs);
  observers.set(tabs, observer);
}

export function disposeChatTabHighlight(tabs: HTMLElement): void {
  observers.get(tabs)?.disconnect();
  observers.delete(tabs);
}

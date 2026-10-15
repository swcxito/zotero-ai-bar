interface RenderedBlock {
  node: Node;
  signature: string;
}

const snapshots = new WeakMap<HTMLElement, RenderedBlock[]>();

/** Keep signatures from before hydration: live nodes contain buttons and data-bound. */
export function updateMarkdownContent(root: HTMLElement, html: string, hydrate: (block: HTMLElement) => void): void {
  // Use the same innerHTML sanitization as native Zotero chat, off the live tree.
  const staging = root.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  staging.innerHTML = html;
  const next = Array.from(
    staging.childNodes,
    (node): RenderedBlock => ({
      node,
      signature: node.nodeType === 1 ? (node as Element).outerHTML : `${node.nodeType}:${node.nodeValue}`,
    })
  );
  let previous = snapshots.get(root) ?? [];
  // A placeholder, an error, or an external render may have replaced our children.
  if (root.childNodes.length !== previous.length || previous.some((block, index) => root.childNodes[index] !== block.node)) {
    previous = Array.from(root.childNodes, (node) => ({ node, signature: '' }));
  }
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix].signature === next[prefix].signature) {
    next[prefix].node = previous[prefix].node;
    prefix++;
  }
  let oldEnd = previous.length;
  let newEnd = next.length;
  while (oldEnd > prefix && newEnd > prefix && previous[oldEnd - 1].signature === next[newEnd - 1].signature) {
    next[--newEnd].node = previous[--oldEnd].node;
  }
  for (let index = prefix; index < oldEnd; index++) root.removeChild(previous[index].node);
  const fragment = root.ownerDocument.createDocumentFragment();
  for (let index = prefix; index < newEnd; index++) fragment.appendChild(next[index].node);
  root.insertBefore(fragment, next[newEnd]?.node ?? null);
  snapshots.set(root, next);
  for (let index = prefix; index < newEnd; index++) {
    if (next[index].node.nodeType === 1) hydrate(next[index].node as HTMLElement);
  }
}

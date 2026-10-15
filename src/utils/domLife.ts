/** Closed Gecko windows can leave dead cross-compartment DOM wrappers. */
export function isUsableNode(node: Node): boolean {
  try {
    return typeof node.nodeType === 'number';
  } catch {
    return false;
  }
}

export function isConnectedNode(node: Node): boolean {
  try {
    return node.isConnected;
  } catch {
    return false;
  }
}

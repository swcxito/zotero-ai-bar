/** Locate chat content consistently in native Shadow DOM and standalone windows. */
export function sessionElement(sessionId: string, selector: string): Element | null {
  const body = addon.data.sidePaneBodyMap?.get(sessionId);
  const scope = body?.querySelector('#ai-bar-chat-root')?.shadowRoot ?? body;
  return scope?.querySelector(selector) ?? null;
}

export function sessionMessageContainer(sessionId: string): HTMLElement | null {
  return sessionElement(sessionId, '.message-container') as HTMLElement | null;
}

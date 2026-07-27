/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * selectionHint.ts
 *
 * This file is part of Zotero AI Bar.
 * Zotero AI Bar - A handy AI assistant integration for Zotero
 *
 * Copyright (c) 2026. swcxito <120201848+swcxito@users.noreply.github.com>
 *
 * Zotero AI Bar is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * Zotero AI Bar is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
 *
 * Repository: https://github.com/swcxito/zotero-ai-bar
 */

/**
 * Pushes the current reader text-selection state into every selection hint
 * bar (one per sidebar section, plus the standalone chat window). Called
 * whenever the reader selection is set, changed, or cleared.
 *
 * The hint bar itself lives inside InputArea; each instance exposes an
 * `update(text, tabId)` API on its wrapper element and decides whether the
 * selection belongs to its own tab.
 */
export function refreshSelectionHints() {
  const text = addon.data.selection.text;
  const selectedTabId = (addon.data.selection.currentReader as any)?.tabID as string | undefined;

  const applyTo = (root: { querySelector: (selectors: string) => Element | null } | null | undefined) => {
    if (!root) return;
    const wrapper = root.querySelector('.input-area-wrapper') as any;
    const api = wrapper?._selectionHintAPI as { update?: (text?: string, tabId?: string) => void } | undefined;
    api?.update?.(text, selectedTabId);
  };

  // Sidebar sections — one per reader tab.
  const map = addon.data.sidePaneBodyMap;
  if (map) {
    for (const body of map.values()) {
      applyTo(((body.querySelector('#ai-bar-chat-root') as HTMLElement | null)?.shadowRoot ?? undefined) as any);
    }
  }

  // Standalone chat window (may not exist or may already be closed).
  try {
    const win = addon.chatManager.chatWindow;
    if (win && !win.closed) {
      applyTo(win.document);
    }
  } catch {
    // Window reference is dead — nothing to update.
  }
}

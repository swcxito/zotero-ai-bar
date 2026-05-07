/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * webStreamsGlobals.ts
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

export function ensureWebStreamsGlobals() {
  const g = globalThis as any;
  const mainWin = Zotero.getMainWindow?.() as any;

  if (typeof g.console === "undefined") {
    if (mainWin?.console) {
      g.console = mainWin.console;
    } else {
      const noop = () => {};
      g.console = {
        debug: noop,
        info: noop,
        log: noop,
        warn: noop,
        error: noop,
      };
    }
  }

  if (typeof g.DOMException === "undefined" && mainWin.DOMException) {
    g.DOMException = mainWin.DOMException;
  }

  if (typeof g.TransformStream !== "undefined") return;
  if (!mainWin) return;

  if (typeof g.TransformStream === "undefined" && mainWin.TransformStream) {
    g.TransformStream = mainWin.TransformStream;
  }
  if (typeof g.ReadableStream === "undefined" && mainWin.ReadableStream) {
    g.ReadableStream = mainWin.ReadableStream;
  }
  if (typeof g.WritableStream === "undefined" && mainWin.WritableStream) {
    g.WritableStream = mainWin.WritableStream;
  }

  if (typeof g.TextEncoder === "undefined" && mainWin.TextEncoder) {
    g.TextEncoder = mainWin.TextEncoder;
  }
  if (typeof g.TextDecoder === "undefined" && mainWin.TextDecoder) {
    g.TextDecoder = mainWin.TextDecoder;
  }
  if (typeof g.TextDecoderStream === "undefined" && mainWin.TextDecoderStream) {
    g.TextDecoderStream = mainWin.TextDecoderStream;
  }
}

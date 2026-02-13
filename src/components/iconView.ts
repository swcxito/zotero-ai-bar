/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * iconView.ts
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

import { TagElementProps } from "zotero-plugin-toolkit";

export function IconView(
  iconMarkup: string,
  sizeRem: number = 1,
  extraClasses: string[] = [],
): TagElementProps {
  const trimmedMarkup = iconMarkup.trim();
  if (trimmedMarkup.startsWith("<svg")) {
    const finalMarkup = trimmedMarkup.includes("xmlns=")
      ? trimmedMarkup
      : trimmedMarkup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    return {
      tag: "span",
      namespace: "html",
      styles: {
        width: `${sizeRem}rem`,
        height: `${sizeRem}rem`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: "0",
      },
      classList: extraClasses,
      properties: { innerHTML: finalMarkup },
    };
  }
  return {
    tag: "img",
    namespace: "html",
    styles: {
      width: `${sizeRem}rem`,
      height: `${sizeRem}rem`,
      pointerEvents: "none",
      flexShrink: "0",
    },
    classList: extraClasses,
    properties: { src: iconMarkup },
  };
}

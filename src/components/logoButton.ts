/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * logoButton.ts
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
import { IconView } from "./iconView";

export function LogoButton(
  text: string,
  iconUrl?: string,
  onClick?: () => void,
): TagElementProps {
  return {
    tag: "button",
    namespace: "html",
    classList: [
      "flex",
      "w-full",
      "items-center",
      "gap-3",
      "px-4",
      "py-1.5",
      "text-left",
      "text-sm",
      "text-zinc-700",
      "transition-colors",
      "hover:bg-rose-400",
      "hover:text-white",
      "dark:text-zinc-200",
    ],
    children: [
      IconView(iconUrl??'', 1),
      {
        tag: "span",
        namespace: "html",
        properties: { innerText: text },
      },
    ],
    listeners: [
      {
        type: "click",
        listener: onClick,
      },
    ],
    // styles: { width: "100%" }
  };
}

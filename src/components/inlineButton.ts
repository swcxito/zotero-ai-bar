/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * inlineButton.ts
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
import { Icons } from "./common";
import { IconView } from "./iconView";

export interface InlineButtonProps {
  onClicked: (e: Event) => void;
}

export function InlineButton({ onClicked }: InlineButtonProps): TagElementProps {
  return {
    tag: "button",
    classList: [
      "w-full",
      "flex",
      "items-center",
      "justify-center",
      "gap-2",
      "py-3",
      "border",
      "border-dashed",
      "border-gray-200",
      "dark:border-zinc-800",
      "rounded-xl",
      "text-xs",
      "text-zinc-700",
      "dark:text-zinc-400",
      "hover:text-rose-600",
      "hover:border-rose-400",
      "hover:bg-rose-50",
      "dark:hover:bg-rose-950",
      "transition-all",
      "duration-200",
      "font-medium",
      "mt-2",
      "mb-4",
    ],
    children: [
      IconView({ iconMarkup: Icons.Add, sizeRem: 1 }),
      { tag: "span", properties: { textContent: "Add Model" } },
    ],
    listeners: [
      {
        type: "click",
        listener: onClicked,
      },
    ],
  };
}

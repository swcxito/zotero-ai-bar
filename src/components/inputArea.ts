/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * inputArea.ts
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

export function InputArea(doc: Document): HTMLElement {
  const containerTags: TagElementProps = {
    tag: "div",
    classList: [
      "input-area",
      "max-w-3xl",
      "my-2",
      "flex",
      "items-center",
      "justify-center",
      "gap-2",
      "bg-slate-50",
      "dark:bg-neutral-900",
      "p-2",
      "rounded-2xl",
      "border-2",
      "border-slate-200",
      "dark:border-neutral-800",
      "focus-within:border-rose-300",
      "dark:focus-within:border-rose-900",
      "transition-all",
      "duration-300",
    ],
    children: [
      {
        tag: "button",
        classList: [
          "p-2.5",
          "text-slate-400",
          "dark:text-neutral-500",
          "hover:text-rose-500",
          "transition-colors",
        ],
        children: [
          IconView(Icons.Link, 1,),
        ],
      },
      {
        tag: "textarea",
        attributes: {
          rows: "1",
          placeholder: "Type a message...",
        },
        classList: [
          "flex-1",
          "bg-transparent",
          "border-none",
          "outline-none",
          "text-slate-900",
          "dark:text-white",
          "placeholder-slate-400",
          "dark:placeholder-neutral-600",
          "resize-none",
          "text-sm",
          "font-medium",
        ],
      },
      {
        tag: "button",
        attributes: {
          disabled: "true",
        },
        classList: [
          "p-2.5",
          "rounded-xl",
          "transition-all",
          "bg-slate-200",
          "dark:bg-neutral-800",
          "text-slate-400",
          "dark:text-neutral-600",
        ],
        children: [
          IconView(Icons.Send, 1.5, ["text-white"]),
        ],
      },
    ],
  };
  const container = ztoolkit.UI.createElement(doc, "div", containerTags) as HTMLElement;
  return container
}

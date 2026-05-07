/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * modelRow.ts
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

import { ButtonBase } from "./buttons/buttonBase";
import { Icons } from "./common";
import { getString } from "../utils/locale";

export interface CardModelRowProps {
  doc: Document;
  data?: { id?: string; name: string; enabled: boolean };
  onSelectModel?: () => void;
}

export function CardModelRow({ doc, data, onSelectModel }: CardModelRowProps) {
  const row = ztoolkit.UI.createElement(doc, "div", {
    tag: "div",
    classList: [
      "flex",
      "items-center",
      "gap-3",
      "p-2",
      "rounded-xl",
      "transition-all",
      "duration-300",
      "bg-zinc-50",
      "dark:bg-zinc-800",
      "hover:ring-2",
      "hover:ring-rose-100",
      "dark:hover:ring-rose-900/50",
      "focus-within:ring-2",
      "focus-within:ring-rose-100",
      "dark:focus-within:ring-rose-900/50",
    ],
    children: [
      {
        tag: "input",
        classList: [
          "mx-1",
          "w-4",
          "h-4",
          "rounded",
          "border-gray-300",
          "dark:border-zinc-600",
          "cursor-pointer",
          "accent-rose-500",
          "bg-white",
          "dark:bg-zinc-800",
        ],
        properties: { type: "checkbox", checked: data?.enabled ?? true },
      },
      {
        tag: "div",
        classList: ["relative", "flex-1", "flex", "items-center"],
        children: [
          ButtonBase({
            iconMarkup: Icons.QuickInput,
            classList: [
              "p-1.5",
              "mr-2",
              "rounded-md",
              "transition-all",
              "duration-200",
              "shrink-0",
              "text-gray-400",
              "hover:text-rose-400",
              "hover:bg-white",
              "dark:hover:bg-zinc-700",
              "cursor-pointer",
            ],
            title: getString("model-dialog-browse-model"),
            onClick: () => onSelectModel?.(),
          }),
          {
            tag: "input",
            classList: [
              "flex-1",
              "bg-transparent",
              "text-sm",
              "px-0",
              "outline-none",
              "rounded",
              "focus:ring-1",
              "ring-rose-300",
              "placeholder:text-gray-400",
              "transition-all",
              "duration-200",
              "font-semibold",
              "cursor-pointer",
            ],
            properties: {
              type: "text",
              placeholder: getString("model-dialog-type-model"),
              value: data?.name || "",
              readOnly: true,
            },
            listeners: [
              {
                type: "click",
                listener: () => onSelectModel?.(),
              },
            ],
          },
        ],
      },
      ButtonBase({
        iconMarkup: Icons.Delete,
        classList: [
          "p-2",
          "text-gray-300",
          "hover:text-red-500",
          "transition-all",
          "duration-200",
          "rounded-lg",
          "shrink-0",
        ],
        title: getString("model-dialog-delete-model"),
        onClick: (e) =>
          (e.currentTarget as HTMLElement).parentElement?.remove(),
      }),
    ],
  });
  (row as any).getData = () => {
    return {
      id: data?.id ?? crypto.randomUUID(),
      name: (row.querySelector('input[type="text"]') as HTMLInputElement).value,
      enabled: (row.querySelector('input[type="checkbox"]') as HTMLInputElement)
        .checked,
    };
  };
  return row;
}

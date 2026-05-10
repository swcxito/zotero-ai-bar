/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * cardHead.ts
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

import { ElementProps, TagElementProps } from "zotero-plugin-toolkit";
import { Icons } from "./common";
import { ButtonBase } from "./buttons/buttonBase";
import { IconView } from "./iconView";

export interface CardHeadProps {
  iconUrl: string;
  providerName: string;
  baseUrl?: string;
  envKeys: string[];
  envValues: Record<string, string>;
  isCustom: boolean;
  onDeleteClicked: () => void;
  onToggleCollapse: (e: Event) => void;
}

function makeEnvInput(key: string, value: string): TagElementProps {
  return {
    tag: "input",
    classList: [
      "flex-1",
      "bg-white",
      "dark:bg-zinc-900",
      "border",
      "border-gray-300",
      "dark:border-zinc-700",
      "rounded-lg",
      "px-2",
      "py-1",
      "text-sm",
      "outline-none",
      "focus:ring-1",
      "focus:ring-rose-300",
      "transition-all",
      "duration-200",
      "ease-in-out",
      "env-input",
    ],
    properties: {
      type: "text",
      placeholder: key,
      value,
    },
  };
}

export function CardHead({
  iconUrl,
  providerName,
  baseUrl,
  envKeys,
  envValues,
  isCustom,
  onDeleteClicked,
  onToggleCollapse,
}: CardHeadProps): ElementProps {
  const nameLabel: TagElementProps = {
    tag: "div",
    classList: [
      "text-xs",
      "font-semibold",
      "opacity-60",
      "truncate",
      "cursor-default",
      "text-zinc-700",
      "dark:text-zinc-300",
    ],
    properties: { innerText: providerName },
  };
  const urlInput: TagElementProps = {
    tag: "input",
    classList: [
      "text-xs",
      "font-semibold",
      "opacity-60",
      "truncate",
      "cursor-default",
      "text-zinc-700",
      "dark:text-zinc-300",
      "rounded-sm",
      "outline-none",
      "focus:ring-1",
      "focus:ring-rose-300",
      "transition-all",
      "duration-200",
      "ease-in-out",
      "px-2",
      "url-input",
    ],
    properties: {
      type: "text",
      value: baseUrl || "",
      placeholder: "Base URL",
    },
  };

  return {
    classList: [
      "p-4",
      "flex",
      "items-center",
      "justify-between",
      "bg-zinc-300/80",
      "dark:bg-zinc-700",
      "transition-all",
      "duration-300",
      "gap-4",
      "border-b",
      "border-zinc-300",
      "dark:border-zinc-700/50",
    ],
    children: [
      {
        tag: "div",
        classList: ["flex", "items-center", "gap-4", "flex-1", "min-w-0"],
        children: [
          IconView({
            iconMarkup: iconUrl,
            sizeRem: 1.5,
            extraClasses: [
              "shrink-0",
              ...(iconUrl.startsWith("chrome://") ? [] : ["provider-icon-img"]),
            ],
          }),
          // text section
          {
            tag: "div",
            classList: [
              "flex",
              "flex-1",
              "flex-col",
              "xl:flex-row",
              "xl:items-center",
              "gap-2",
              "min-w-10",
            ],
            children: [
              isCustom ? urlInput : nameLabel,
              ...envKeys.map((key) => makeEnvInput(key, envValues[key] ?? "")),
            ],
          },
          // tail buttons
          {
            tag: "div",
            classList: ["flex", "items-center", "gap-1", "shrink-0"],
            children: [
              ButtonBase({
                iconMarkup: Icons.Delete,
                classList: [
                  "p-2",
                  "text-zinc-500",
                  "hover:text-red-600",
                  "transition-colors",
                  "duration-200",
                  "rounded-lg",
                  "hover:bg-white/50",
                  "dark:hover:bg-red-950",
                ],
                onClick: () => onDeleteClicked(),
              }),
              ButtonBase({
                iconMarkup: Icons.Chevron,
                classList: [
                  "p-2",
                  "text-zinc-500",
                  "hover:text-black",
                  "dark:hover:text-white",
                  "transition-all",
                  "duration-200",
                  "rounded-lg",
                  "hover:bg-white/50",
                  "dark:hover:bg-zinc-800",
                ],
                iconExtraClasses: [
                  "transition-transform",
                  "duration-300",
                  "ease-in-out",
                ],
                onClick: (e) => onToggleCollapse(e),
              }),
            ],
          },
        ],
      },
    ],
  };
}

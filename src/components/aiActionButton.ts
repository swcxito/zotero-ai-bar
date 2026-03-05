/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * aiButton.ts
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
import { ActionButton } from "./actionButton";

export interface AIButtonProps {
  label: string;
  icon?: string;
  onClick: (e: Event) => Promise<void>;
}

export function AiActionButton({
  label,
  icon = "",
  onClick,
}: AIButtonProps): TagElementProps {
  return ActionButton({
    label: icon ? `${icon}${label}` : label,
    className: "ai-btn",
    onClick: async (e, btn) => {
      if ((btn as HTMLButtonElement).disabled) return;

      const container = btn.closest(".ai-bar-container") as HTMLElement;
      if (container) {
        container
          .querySelectorAll("button, textarea")
          .forEach((el: Element) => {
            (el as HTMLButtonElement | HTMLTextAreaElement).disabled = true;
          });
        container.querySelectorAll(".ai-send-btn").forEach((el: Element) => {
          (el as HTMLElement).classList.add("disabled");
        });
      }

      e.stopPropagation();
      setTimeout(() => {
        const bar = btn.closest(".ai-bar-container") as HTMLElement;
        if (bar) bar.style.display = "none";
      }, 300);

      await onClick(e);
    },
  });
}

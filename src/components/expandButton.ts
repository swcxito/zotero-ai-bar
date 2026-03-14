/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * expandButton.ts
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
import { getString } from "../utils/locale";
import {
  closeDropdownMenu,
  openDropdownMenu,
  toggleDropdownMenu,
} from "./dropdownMenu";
import { ActionButton } from "./actionButton";
import { Icons } from "./common";

export interface ExpandMenuItem {
  id: string;
  icon?: string;
  label: string;
  onClick?: () => void;
}

export interface ExpandButtonProps {
  label?: string;
  icon?: string;
  className?: string;
  menuItems?: ExpandMenuItem[];
}

export function ExpandButton({
  label,
  icon = Icons.Chevron,
  className = "",
  menuItems = [],
}: ExpandButtonProps = {}): TagElementProps {
  const finalLabel = label || getString("reader-bar-expand");
  const hasItems = menuItems.length > 0;
  const closeDelayMs = 180;
  let closeTimer: number | undefined;

  const clearCloseTimer = (container: HTMLElement) => {
    const view = container.ownerDocument.defaultView;
    if (!view || closeTimer === undefined) return;
    view.clearTimeout(closeTimer);
    closeTimer = undefined;
  };

  const instanceId = `expand-${Math.random().toString(36).substr(2, 9)}`;
  const menuId = `${instanceId}-menu`;

  const openMenu = (container: HTMLElement, anchor: HTMLElement) => {
    clearCloseTimer(container);
    if (!hasItems) return;
    openDropdownMenu({
      menuId,
      anchor,
      container,
      groups: [
        {
          items: menuItems.map((item) => ({
            id: item.id,
            label: item.label,
            iconMarkup: item.icon,
            onClick: item.onClick,
          })),
        },
      ],
    });
  };

  const closeMenu = (container: HTMLElement) => {
    clearCloseTimer(container);
    closeDropdownMenu(container.ownerDocument, menuId);
  };

  const scheduleCloseMenu = (container: HTMLElement) => {
    const view = container.ownerDocument.defaultView;
    if (!view) {
      closeMenu(container);
      return;
    }
    clearCloseTimer(container);
    closeTimer = view.setTimeout(() => {
      closeMenu(container);
      closeTimer = undefined;
    }, closeDelayMs);
  };

  const toggleMenu = (container: HTMLElement, anchor: HTMLElement) => {
    if (!hasItems) return;
    toggleDropdownMenu({
      menuId,
      anchor,
      container,
      groups: [
        {
          items: menuItems.map((item) => ({
            id: item.id,
            label: item.label,
            iconMarkup: item.icon,
            onClick: item.onClick,
          })),
        },
      ],
    });
  };

  return {
    tag: "div",
    classList: ["expand-container", ...(className ? className.split(" ") : [])],
    id: instanceId,
    listeners: hasItems
      ? [
          {
            type: "mouseenter",
            listener: (e: Event) => {
              const container = e.currentTarget as HTMLElement;
              const anchor = container.querySelector("button") as HTMLElement;
              if (!anchor) return;
              openMenu(container, anchor);
            },
          },
          {
            type: "mouseleave",
            listener: (e: Event) => {
              const container = e.currentTarget as HTMLElement;
              scheduleCloseMenu(container);
            },
          },
        ]
      : undefined,
    children: [
      ActionButton({
        label: finalLabel,
        icon,
        className: "ai-btn expand-trigger-btn",
        onClick: (e, btn) => {
          e.stopPropagation();
          const container = (btn as HTMLElement).closest(
            `#${instanceId}`,
          ) as HTMLElement;
          if (!container) return;
          toggleMenu(container, btn);
        },
      }),
    ],
  };
}

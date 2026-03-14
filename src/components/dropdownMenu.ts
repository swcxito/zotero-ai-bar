/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * dropdownMenu.ts
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

export interface DropdownMenuItem {
  id: string;
  label: string;
  selected?: boolean;
  iconText?: string;
  iconMarkup?: string;
  renderLeading?: (doc: Document) => HTMLElement | null;
  onClick?: () => void;
}

export interface DropdownMenuGroup {
  title?: string;
  items: DropdownMenuItem[];
}

export interface OpenDropdownMenuOptions {
  menuId: string;
  anchor: HTMLElement;
  container: HTMLElement;
  groups: DropdownMenuGroup[];
  emptyText?: string;
  closeOnOutsideClick?: boolean;
}

const dropdownCloseHandlers = new Map<string, (e: Event) => void>();

export function closeDropdownMenu(doc: Document, menuId: string) {
  const menu = doc.getElementById(menuId);
  if (menu) {
    menu.remove();
  }

  const closeHandler = dropdownCloseHandlers.get(menuId);
  if (closeHandler) {
    doc.removeEventListener("click", closeHandler, true);
    dropdownCloseHandlers.delete(menuId);
  }
}

export function openDropdownMenu({
  menuId,
  anchor,
  container,
  groups,
  emptyText,
  closeOnOutsideClick = true,
}: OpenDropdownMenuOptions): HTMLElement {
  const doc = anchor.ownerDocument;

  // Close any open dropdowns in the same popup to avoid overlap.
  const menuIds = Array.from(dropdownCloseHandlers.keys());
  menuIds.forEach((id) => {
    closeDropdownMenu(doc, id);
  });

  // Keep one menu instance per anchor menu id.
  closeDropdownMenu(doc, menuId);

  const dropdown = doc.createElement("div");
  dropdown.id = menuId;
  dropdown.className = "model-dropdown-menu ai-bar-dropdown-menu";

  const validGroups = groups.filter((group) => group.items.length > 0);
  if (validGroups.length === 0) {
    const emptyItem = doc.createElement("div");
    emptyItem.className = "model-dropdown-empty";
    emptyItem.textContent = emptyText || "No options available";
    dropdown.appendChild(emptyItem);
  } else {
    validGroups.forEach((group) => {
      if (group.title) {
        const groupTitle = doc.createElement("div");
        groupTitle.className = "model-dropdown-group-title";
        groupTitle.textContent = group.title;
        dropdown.appendChild(groupTitle);
      }

      const groupList = doc.createElement("div");
      groupList.className = "model-dropdown-group-list";

      group.items.forEach((item) => {
        const itemEl = doc.createElement("div");
        itemEl.className = "model-dropdown-item";
        if (item.selected) {
          itemEl.classList.add("selected");
        }

        if (item.renderLeading) {
          const leading = item.renderLeading(doc);
          if (leading) {
            itemEl.appendChild(leading);
          }
        } else if (item.iconMarkup) {
          const icon = doc.createElement("span");
          icon.className = "dropdown-item-icon-text";
          icon.innerHTML = item.iconMarkup;
          itemEl.appendChild(icon);
        } else if (item.iconText) {
          const icon = doc.createElement("span");
          icon.className = "dropdown-item-icon-text";
          icon.textContent = item.iconText;
          itemEl.appendChild(icon);
        }

        const text = doc.createElement("span");
        text.textContent = item.label;
        itemEl.appendChild(text);

        itemEl.addEventListener("click", (e: Event) => {
          e.stopPropagation();
          item.onClick?.();
          closeDropdownMenu(doc, menuId);
        });

        groupList.appendChild(itemEl);
      });

      dropdown.appendChild(groupList);
    });
  }

  container.appendChild(dropdown);

  const containerRect = container.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  dropdown.style.position = "absolute";
  dropdown.style.top = `${anchorRect.bottom - containerRect.top + 2}px`;
  dropdown.style.left = `${anchorRect.left - containerRect.left}px`;
  dropdown.style.zIndex = "10001";

  if (closeOnOutsideClick) {
    const closeHandler = (e: Event) => {
      const target = e.target as Node;
      if (dropdown.contains(target) || anchor.contains(target)) {
        return;
      }
      closeDropdownMenu(doc, menuId);
    };

    dropdownCloseHandlers.set(menuId, closeHandler);
    setTimeout(() => {
      doc.addEventListener("click", closeHandler, true);
    }, 0);
  }

  return dropdown;
}

export function toggleDropdownMenu(options: OpenDropdownMenuOptions) {
  const { menuId, anchor } = options;
  const doc = anchor.ownerDocument;
  const existing = doc.getElementById(menuId);
  if (existing) {
    closeDropdownMenu(doc, menuId);
    return;
  }
  openDropdownMenu(options);
}

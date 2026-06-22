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

// TODO review
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
  dropUp?: boolean;
}

const dropdownCloseHandlers = new Map<string, { handler: (e: Event) => void; doc: Document }>();

type DropdownRoot = Document | ShadowRoot;

function getRoot(anchor: HTMLElement): DropdownRoot {
  const root = anchor.getRootNode();
  return root.nodeType === 11 /* DocumentFragment */ ? (root as ShadowRoot) : (root as Document);
}

export function closeDropdownMenu(root: DropdownRoot, menuId: string) {
  const menu = root.getElementById(menuId);
  if (menu) {
    menu.remove();
  }

  const entry = dropdownCloseHandlers.get(menuId);
  if (entry) {
    entry.doc.removeEventListener('click', entry.handler, true);
    dropdownCloseHandlers.delete(menuId);
  }
}

/**
 * Fade the dropdown out (opacity transition) then remove it and clean up the
 * outside-click handler. Used for hover-to-close behavior on the sidebar
 * model selector.
 */
export function fadeCloseDropdownMenu(root: DropdownRoot, menuId: string, fadeMs = 150) {
  const menu = root.getElementById(menuId) as HTMLElement | null;
  if (!menu) return;
  const view = menu.ownerDocument.defaultView;
  menu.style.transition = `opacity ${fadeMs}ms ease-out`;
  menu.style.opacity = '0';
  const cleanup = () => {
    if (menu.isConnected) menu.remove();
    const entry = dropdownCloseHandlers.get(menuId);
    if (entry) {
      entry.doc.removeEventListener('click', entry.handler, true);
      dropdownCloseHandlers.delete(menuId);
    }
  };
  menu.addEventListener('transitionend', cleanup, { once: true });
  if (view) view.setTimeout(cleanup, fadeMs + 30);
  else cleanup();
}

export function openDropdownMenu({
  menuId,
  anchor,
  container,
  groups,
  emptyText,
  closeOnOutsideClick = true,
  dropUp = false,
}: OpenDropdownMenuOptions): HTMLElement {
  const doc = anchor.ownerDocument;
  const root = getRoot(anchor);

  // Close any open dropdowns in the same popup to avoid overlap.
  const menuIds = Array.from(dropdownCloseHandlers.keys());
  menuIds.forEach((id) => {
    closeDropdownMenu(root, id);
  });

  // Keep one menu instance per anchor menu id.
  closeDropdownMenu(root, menuId);

  const dropdown = doc.createElement('div');
  dropdown.id = menuId;
  dropdown.className = 'model-dropdown-menu';

  const validGroups = groups.filter((group) => group.items.length > 0);
  if (validGroups.length === 0) {
    const emptyItem = doc.createElement('div');
    emptyItem.className = 'model-dropdown-empty';
    emptyItem.textContent = emptyText || 'No options available';
    dropdown.appendChild(emptyItem);
  } else {
    validGroups.forEach((group) => {
      if (group.title) {
        const groupTitle = doc.createElement('div');
        groupTitle.className = 'model-dropdown-group-title';
        groupTitle.textContent = group.title;
        dropdown.appendChild(groupTitle);
      }

      const groupList = doc.createElement('div');
      groupList.className = 'model-dropdown-group-list';

      group.items.forEach((item) => {
        const itemEl = doc.createElement('div');
        itemEl.className = 'model-dropdown-item';
        if (item.selected) {
          itemEl.classList.add('selected');
        }

        if (item.renderLeading) {
          const leading = item.renderLeading(doc);
          if (leading) {
            itemEl.appendChild(leading);
          }
        } else if (item.iconMarkup) {
          const icon = doc.createElement('span');
          icon.className = 'dropdown-item-icon-text';
          icon.innerHTML = item.iconMarkup;
          itemEl.appendChild(icon);
        } else if (item.iconText) {
          const icon = doc.createElement('span');
          icon.className = 'dropdown-item-icon-text';
          icon.textContent = item.iconText;
          itemEl.appendChild(icon);
        }

        const text = doc.createElement('span');
        text.textContent = item.label;
        itemEl.appendChild(text);

        itemEl.addEventListener('click', (e: Event) => {
          e.stopPropagation();
          item.onClick?.();
          closeDropdownMenu(root, menuId);
        });

        groupList.appendChild(itemEl);
      });

      dropdown.appendChild(groupList);
    });
  }

  container.appendChild(dropdown);

  const containerRect = container.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  dropdown.style.position = 'absolute';
  if (dropUp) {
    // Pop above the button, right-aligned with it (sidebar model selector).
    dropdown.style.bottom = `${containerRect.bottom - anchorRect.top + 2}px`;
    dropdown.style.top = 'auto';
    dropdown.style.right = `${containerRect.right - anchorRect.right}px`;
    dropdown.style.left = 'auto';
  } else {
    dropdown.style.top = `${anchorRect.bottom - containerRect.top + 2}px`;
    dropdown.style.bottom = 'auto';
    dropdown.style.left = `${anchorRect.left - containerRect.left}px`;
    dropdown.style.right = 'auto';
  }
  dropdown.style.zIndex = '10001';

  if (closeOnOutsideClick) {
    const closeHandler = (e: Event) => {
      const path = e.composedPath();
      if (path.includes(dropdown) || path.includes(anchor)) {
        return;
      }
      closeDropdownMenu(root, menuId);
    };

    dropdownCloseHandlers.set(menuId, { handler: closeHandler, doc });
    setTimeout(() => {
      // Register on the owner document so clicks outside the Shadow DOM
      // (e.g., on the PDF reader) still close the dropdown. composedPath()
      // is used in the handler so it works across shadow boundaries.
      doc.addEventListener('click', closeHandler, true);
    }, 0);
  }

  return dropdown;
}

export function toggleDropdownMenu(options: OpenDropdownMenuOptions): HTMLElement | undefined {
  const { menuId, anchor } = options;
  const root = getRoot(anchor);
  const existing = root.getElementById(menuId);
  if (existing) {
    closeDropdownMenu(root, menuId);
    return undefined;
  }
  return openDropdownMenu(options);
}

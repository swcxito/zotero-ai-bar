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

import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import { installWebGlobals } from '../utils/installWebGlobals';
import { IconView } from './iconView';

const positionCleanups = new WeakMap<Element, () => void>();

export function disposeDropdownMenu(menu: Element): void {
  positionCleanups.get(menu)?.();
  positionCleanups.delete(menu);
}
export interface DropdownMenuItem {
  id: string;
  label: string;
  selected?: boolean;
  disabled?: boolean;
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
  align?: 'left' | 'center' | 'right';
  presentation?: { menu: string; title: string; item: string; list?: string; minWidth?: string };
  dropUp?: boolean;
}

type DropdownRoot = Document | ShadowRoot;

function getRoot(anchor: HTMLElement): DropdownRoot {
  return anchor.getRootNode() as DropdownRoot;
}

export function closeDropdownMenu(root: DropdownRoot, menuId: string) {
  const menu = root.getElementById(menuId);
  const view = menu?.ownerDocument.defaultView;
  if (menu && view) menu.dispatchEvent(new view.Event('zaibar-menu-close'));
  if (menu) disposeDropdownMenu(menu);
  menu?.remove();
}

/** Render options and positioning; bindMenu owns every interaction and resource. */
export function openDropdownMenu({
  menuId,
  anchor,
  container,
  groups,
  emptyText,
  align,
  presentation,
  dropUp = false,
}: OpenDropdownMenuOptions): HTMLElement {
  const doc = anchor.ownerDocument;
  installWebGlobals(globalThis, doc.defaultView);
  const root = getRoot(anchor);

  // Keep one menu instance per anchor menu id.
  closeDropdownMenu(root, menuId);

  const dropdown = doc.createElement('div');
  dropdown.id = menuId;
  dropdown.className = presentation?.menu ?? 'model-dropdown-menu';
  if (presentation?.minWidth) dropdown.style.minWidth = presentation.minWidth;

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
        groupTitle.className = presentation?.title ?? 'model-dropdown-group-title';
        groupTitle.textContent = group.title;
        dropdown.appendChild(groupTitle);
      }

      const groupList = doc.createElement('div');
      groupList.className = presentation?.list ?? 'model-dropdown-group-list';

      group.items.forEach((item) => {
        const itemEl = ztoolkit.UI.createElement(doc, 'button', { namespace: 'html' }) as HTMLButtonElement;
        itemEl.type = 'button';
        itemEl.disabled = item.disabled ?? false;
        itemEl.dataset.zaibarCopyIgnore = 'true';
        itemEl.className = presentation?.item ?? 'model-dropdown-item';
        itemEl.style.userSelect = 'none';
        if (item.disabled) itemEl.style.opacity = '0.45';
        if (item.selected) {
          itemEl.classList.add(presentation ? 'is-selected' : 'selected');
        }

        if (item.renderLeading) {
          const leading = item.renderLeading(doc);
          if (leading) {
            itemEl.appendChild(leading);
          }
        } else if (item.iconMarkup) {
          const icon = doc.createElement('span');
          icon.className = 'dropdown-item-icon-text';
          icon.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: item.iconMarkup })));
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

        itemEl.addEventListener('mouseenter', () => {
          if (!itemEl.disabled) itemEl.classList.add('is-hover');
        });
        itemEl.addEventListener('mouseleave', () => itemEl.classList.remove('is-hover'));
        itemEl.addEventListener('click', (e: Event) => {
          if (itemEl.disabled) return;
          e.stopPropagation();
          item.onClick?.();
          closeDropdownMenu(root, menuId);
        });

        groupList.appendChild(itemEl);
      });

      dropdown.appendChild(groupList);
    });
  }

  // Remove the menu from normal flow before measuring its anchor. Otherwise
  // a bottom-aligned composer first grows by the menu height, shifting the
  // measured button and leaving a full menu-height gap after positioning.
  dropdown.style.position = 'absolute';
  container.appendChild(dropdown);

  const containerRect = container.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
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

  const horizontal = align ?? (dropUp ? 'right' : 'left');
  dropdown.style.left =
    horizontal === 'right' ? 'auto' : `${anchorRect.left - containerRect.left + (horizontal === 'center' ? anchorRect.width / 2 : 0)}px`;
  dropdown.style.right = horizontal === 'right' ? `${containerRect.right - anchorRect.right}px` : 'auto';
  if (horizontal === 'center') dropdown.style.translate = '-50% 0';
  let disposed = false;
  let sequence = 0;
  const computed = doc.defaultView!.getComputedStyle(dropdown);
  const maxHeight = Number.parseFloat(computed?.maxHeight || '') || 300;
  const maxWidth = Number.parseFloat(computed?.maxWidth || '') || Infinity;
  const placement = `${dropUp ? 'top' : 'bottom'}${horizontal === 'center' ? '' : horizontal === 'right' ? '-end' : '-start'}` as const;
  const updatePosition = async () => {
    const current = ++sequence;
    const rootBoundary = { x: 0, y: 0, width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight };
    const position = await computePosition(anchor, dropdown, {
      placement,
      middleware: [
        offset(2),
        flip({ rootBoundary, boundary: [] }),
        shift({ padding: 8, rootBoundary, boundary: [] }),
        size({
          padding: 8,
          rootBoundary,
          boundary: [],
          apply({ availableHeight, availableWidth }) {
            if (disposed) return;
            dropdown.style.maxHeight = `${Math.max(0, Math.min(maxHeight, availableHeight))}px`;
            dropdown.style.maxWidth = `${Math.max(0, Math.min(maxWidth, availableWidth))}px`;
            dropdown.style.overflowY = 'auto';
          },
        }),
      ],
    });
    if (disposed || current !== sequence || !dropdown.isConnected) return;
    // Floating UI has already applied alignment, including centering.
    dropdown.style.translate = 'none';
    dropdown.style.bottom = dropdown.style.right = 'auto';
    dropdown.style.left = `${position.x}px`;
    dropdown.style.top = `${position.y}px`;
  };
  const update = () => {
    if (!anchor.isConnected || !dropdown.isConnected) {
      void Promise.resolve().then(() => disposeDropdownMenu(dropdown));
      return;
    }
    void updatePosition().catch((error) => ztoolkit.log('[dropdown] positioning failed:', error));
  };
  // XUL windows have no HTML body. Floating UI's ancestor discovery assumes one;
  // use the document's scroll capture and window resize events on native hosts.
  const nativeDocument = !doc.body;
  const cleanup = autoUpdate(anchor, dropdown, update, {
    ancestorScroll: !nativeDocument,
    ancestorResize: !nativeDocument,
    layoutShift: !nativeDocument,
    animationFrame: nativeDocument,
  });
  if (nativeDocument) {
    doc.addEventListener('scroll', update, true);
    doc.defaultView!.addEventListener('resize', update);
  }
  positionCleanups.set(dropdown, () => {
    disposed = true;
    cleanup();
    if (nativeDocument) {
      doc.removeEventListener('scroll', update, true);
      doc.defaultView!.removeEventListener('resize', update);
    }
  });
  return dropdown;
}

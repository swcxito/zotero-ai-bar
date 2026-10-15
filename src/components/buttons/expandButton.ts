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

import { TagElementProps } from 'zotero-plugin-toolkit';
import { getString } from '../../utils/locale';
import { openDropdownMenu } from '../dropdownMenu';
import { bindMenu } from '../menuController';
import { ActionButton } from './actionButton';
import { Icons } from '../common';

export interface ExpandMenuItem {
  id: string;
  icon?: string;
  label: string;
  onClick?: () => void;
}
export interface ExpandButtonProps {
  label?: string;
  icon?: string;
  classList?: string[];
  menuItems?: ExpandMenuItem[];
}

export function ExpandButton({ label, icon = Icons.Chevron, classList = [], menuItems = [] }: ExpandButtonProps = {}): TagElementProps {
  const menuId = `expand-${crypto.randomUUID()}`;
  let bound = false;
  return {
    tag: 'div',
    classList: ['expand-container', ...classList],
    listeners: [
      {
        type: 'mouseenter',
        listener: (event: Event) => {
          if (bound || !menuItems.length) return;
          bound = true;
          const container = event.currentTarget as HTMLElement;
          const anchor = container.querySelector('button')!;
          const controller = bindMenu(
            anchor,
            () =>
              openDropdownMenu({
                menuId,
                anchor,
                container,
                groups: [{ items: menuItems.map((item) => ({ ...item, iconMarkup: item.icon })) }],
              }),
            'hover'
          );
          controller.open();
        },
      },
    ],
    children: [ActionButton({ label: label || getString('reader-bar-expand'), icon, classList: ['ai-btn', 'expand-trigger-btn'] })],
  };
}

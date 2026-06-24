/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * actionButton.ts
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
import { ButtonBase, ButtonClickDecorator, ButtonClickHandler } from './buttonBase';
import { BUTTON_VARIANTS } from './buttonVariants';

export interface ActionButtonProps {
  label: string;
  icon?: string;
  onClick?: (e: MouseEvent, btn: HTMLElement) => void;
  title?: string;
  classList?: string[];
  enabled?: boolean;
}

export function ActionButton({ label, icon, onClick, title, classList = [], enabled = true }: ActionButtonProps): TagElementProps {
  const withRipple: ButtonClickDecorator =
    (next: ButtonClickHandler): ButtonClickHandler =>
    (e: MouseEvent, btn: HTMLButtonElement) => {
      // Keep ripple behavior centralized in the action-style button.
      const ripple = btn.ownerDocument!.createElement('span');
      ripple.className = 'ripple';

      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const hasPointerPosition = typeof e.clientX === 'number' && typeof e.clientY === 'number' && (e.clientX !== 0 || e.clientY !== 0);
      const clickX = hasPointerPosition ? e.clientX - rect.left : rect.width / 2;
      const clickY = hasPointerPosition ? e.clientY - rect.top : rect.height / 2;
      const x = clickX - size / 2;
      const y = clickY - size / 2;

      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;

      btn.appendChild(ripple);
      ripple.addEventListener('animationend', () => {
        ripple.remove();
      });

      return next(e, btn);
    };

  // When `ai-btn` is in classList, the button renders in the reader text-
  // selection popup, which only loads zoteroAIBar.css (plain CSS, no Tailwind).
  // The BUTTON_VARIANTS.action utilities would be dead code there and only
  // create confusion — skip them so .ai-btn is the single source of styling.
  const useTailwindVariants = !classList.includes('ai-btn');

  return ButtonBase({
    label,
    iconMarkup: icon,
    onClick,
    title: title || '',
    classList: [...(useTailwindVariants ? BUTTON_VARIANTS.action : []), ...classList],
    enabled,
    labelClassList: ['btn-label'],
    clickDecorators: [withRipple],
  });
}

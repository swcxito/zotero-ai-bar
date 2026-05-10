/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * buttonBase.ts
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
import { IconView } from '../iconView';

export type ButtonClickHandler = (e: MouseEvent, btn: HTMLButtonElement) => void | Promise<void>;

export type ButtonClickDecorator = (next: ButtonClickHandler) => ButtonClickHandler;

export interface ButtonBaseProps {
  label?: string;
  iconMarkup?: string;
  iconExtraClasses?: string[];
  onClick?: ButtonClickHandler;
  clickDecorators?: ButtonClickDecorator[];
  title?: string;
  classList?: string[];
  enabled?: boolean;
  labelClassList?: string[];
}

const noopClick: ButtonClickHandler = () => {};

export function ButtonBase({
  label,
  iconMarkup,
  iconExtraClasses = [],
  onClick,
  clickDecorators = [],
  title,
  classList = [],
  enabled = true,
  labelClassList = [],
}: ButtonBaseProps): TagElementProps {
  const children: TagElementProps[] = [];

  if (iconMarkup) {
    children.push(
      IconView({
        iconMarkup,
        sizeRem: 1,
        extraClasses: iconExtraClasses,
      })
    );
  }

  if (typeof label === 'string') {
    children.push({
      tag: 'span',
      classList: labelClassList,
      properties: { textContent: label },
    });
  }

  const button: TagElementProps = {
    tag: 'button',
    classList,
    properties: {
      disabled: !enabled,
      ...(title !== undefined ? { title } : {}),
    },
    children,
  };

  if (onClick || clickDecorators.length > 0) {
    const composedHandler = clickDecorators.reduceRight((next, decorate) => decorate(next), onClick ?? noopClick);

    button.listeners = [
      {
        type: 'click',
        listener: (e: Event) => {
          void composedHandler(e as MouseEvent, e.currentTarget as HTMLButtonElement);
        },
      },
    ];
  }

  return button;
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * inlineButton.ts
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
import { ButtonBase } from './buttonBase';
import { BUTTON_VARIANTS } from './buttonVariants';
import { Icons } from '../common';
import { getString } from '../../utils/locale';

export interface InlineButtonProps {
  onClicked: (e: Event) => void;
  label?: string;
  classList?: string[];
}

export function InlineButton({ onClicked, label = getString('model-dialog-add-model'), classList }: InlineButtonProps): TagElementProps {
  return ButtonBase({
    label,
    iconMarkup: Icons.Add,
    classList: classList ?? [...BUTTON_VARIANTS.inline],
    labelClassList: ['inline-button-label'],
    onClick: (e) => onClicked(e),
  });
}

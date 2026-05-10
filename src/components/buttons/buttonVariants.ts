/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * buttonVariants.ts
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

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * buttonVariants.ts
 *
 * Shared class presets for button components.
 */

export const BUTTON_VARIANTS = {
  action: [
    'relative',
    'overflow-hidden',
    'px-2.5',
    'py-1.5',
    'rounded-lg',
    'border',
    'border-transparent',
    'hover:border-slate-200',
    'dark:hover:border-neutral-800',
    'hover:bg-slate-50',
    'dark:hover:bg-neutral-900',
    'text-slate-400',
    'dark:text-neutral-500',
    'hover:text-rose-500',
    'dark:hover:text-rose-400',
    'transition-all',
    'flex',
    'items-center',
    'gap-1.5',
    'text-[10px]',
    'font-bold',
    'uppercase',
    'tracking-wider',
    'justify-center',
  ],
  inline: [
    'w-full',
    'flex',
    'items-center',
    'justify-center',
    'gap-2',
    'py-3',
    'border',
    'border-dashed',
    'border-gray-200',
    'dark:border-zinc-800',
    'rounded-xl',
    'text-xs',
    'text-zinc-700',
    'dark:text-zinc-400',
    'hover:text-rose-600',
    'hover:border-rose-400',
    'hover:bg-rose-50',
    'dark:hover:bg-rose-950',
    'transition-all',
    'duration-200',
    'font-medium',
    'mt-2',
    'mb-4',
  ],
  providerLogo: [
    'flex',
    'w-full',
    'items-center',
    'gap-3',
    'px-4',
    'py-1.5',
    'text-left',
    'text-sm',
    'text-zinc-700',
    'transition-colors',
    'hover:bg-rose-400',
    'hover:text-white',
    'dark:text-zinc-200',
  ],
} as const;

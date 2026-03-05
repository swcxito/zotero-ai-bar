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

import { TagElementProps } from "zotero-plugin-toolkit";
import { IconView } from "./iconView";

export interface ActionButtonProps {
    label: string;
    icon?: string;
    onClick?: (e: MouseEvent, btn: HTMLElement) => void;
    title?: string;
    className?: string;
    enabled?: boolean;
}

export function ActionButton({
    label,
    icon,
    onClick,
    title,
    className,
    enabled = true,
}: ActionButtonProps): TagElementProps {
    return {
        tag: "button",
        classList: [
            "relative",
            "overflow-hidden",
            "px-2.5",
            "py-1.5",
            "rounded-lg",
            "border",
            "border-transparent",
            "hover:border-slate-200",
            "dark:hover:border-neutral-800",
            "hover:bg-slate-50",
            "dark:hover:bg-neutral-900",
            "text-slate-400",
            "dark:text-neutral-500",
            "hover:text-rose-500",
            "dark:hover:text-rose-400",
            "transition-all",
            "flex",
            "items-center",
            "gap-1.5",
            "text-[10px]",
            "font-bold",
            "uppercase",
            "tracking-wider",
            "justify-center",
            ...(className ? className.split(" ") : []),
        ],
        properties: {
            title: title || "",
            disabled: !enabled,
        },
        children: [
            ...(icon ? [IconView({ iconMarkup: icon, sizeRem: 1 })] : []),
            {
                tag: "span",
                classList: ["btn-label"],
                properties: {
                    textContent: label,
                },
            },
        ],
        listeners: [
            {
                type: "click",
                listener: (e: Event) => {
                    const btn = e.currentTarget as HTMLButtonElement;

                    // Create ripple effect
                    const ripple = btn.ownerDocument!.createElement("span");
                    ripple.className = "ripple";
                    const rect = btn.getBoundingClientRect();
                    const size = Math.max(rect.width, rect.height);
                    const mouseEvent = e as MouseEvent;
                    const hasPointerPosition =
                        typeof mouseEvent.clientX === "number" &&
                        typeof mouseEvent.clientY === "number" &&
                        (mouseEvent.clientX !== 0 || mouseEvent.clientY !== 0);
                    const clickX = hasPointerPosition
                        ? mouseEvent.clientX - rect.left
                        : rect.width / 2;
                    const clickY = hasPointerPosition
                        ? mouseEvent.clientY - rect.top
                        : rect.height / 2;
                    const x = clickX - size / 2;
                    const y = clickY - size / 2;

                    ripple.style.width = ripple.style.height = `${size}px`;
                    ripple.style.left = `${x}px`;
                    ripple.style.top = `${y}px`;

                    btn.appendChild(ripple);

                    ripple.addEventListener("animationend", () => {
                        ripple.remove();
                    });
                    if (onClick) {
                        onClick(e as MouseEvent, e.currentTarget as HTMLElement);
                    }
                },
            },
        ],
    };
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * chatBox.ts
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

import { Icons } from "./common";
import { getString } from "../utils/locale";
import { IconView } from "./iconView";

interface CreateActionButtonProps {
  label: string;
  icon: string;
  onClick?: (e: MouseEvent, btn: HTMLElement) => void;
  title?: string;
  className?: string;
  enabled?: boolean;
}

function createActionButton({
  label,
  icon,
  onClick,
  title,
  className,
  enabled = true,
}: CreateActionButtonProps): any {
  return {
    tag: "button",
    classList: [
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
      IconView({ iconMarkup: icon, sizeRem: 1 }),
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
        listener: (e: MouseEvent) => {
          if (onClick) {
            onClick(e, e.currentTarget as HTMLElement);
          }
        },
      },
    ],
  };
}

export interface ChatBoxProps {
  doc: Document;
  annotation: _ZoteroTypes.Annotations.AnnotationJson | undefined;
  isUser?: boolean;
  onRegenerate?: () => void;
}

export function ChatBox({
  doc,
  annotation,
  isUser = false,
  onRegenerate,
}: ChatBoxProps): Element {
  return ztoolkit.UI.createElement(doc, "div", {
    tag: "div",
    classList: [
      "w-full",
      "animate-in",
      "fade-in",
      "slide-in-from-bottom-3",
      "duration-300",
      "flex-col",
      ...(isUser
        ? [
            "items-end",
            "max-w-[85%]",
            "sm:max-w-[75%]",
            "justify-end",
            "self-end",
          ]
        : ["items-start", "w-full"]),
    ],
    children: [
      {
        tag: "div",
        classList: [
          "chat-message",
          "transition-all",
          "duration-300",
          "w-full",
          "text-justify",
          "break-words",
          ...(isUser
            ? [
                "px-5",
                "py-3.5",
                "rounded-2xl",
                "bg-rose-500",
                "text-white",
                "dark:bg-rose-600",
                "rounded-tr-none",
                "shadow-md",
                "shadow-rose-200/50",
                "dark:shadow-none",
                "text-sm",
                "leading-relaxed",
              ]
            : [
                "pr-4",
                "w-full",
                "text-slate-800",
                "dark:text-rose-50/90",
                "text-[15px]",
                "leading-relaxed",
                "py-1",
              ]),
        ],
      },
      //todo: add streaming indicator
      // Actions container
      {
        tag: "div",
        classList: [
          "chat-actions",
          "mt-4",
          "flex",
          "items-center",
          "gap-1.5",
          ...(isUser
            ? ["justify-end"]
            : [
                "justify-start",
                "opacity-60",
                "hover:opacity-100",
                "transition-opacity",
                "duration-300",
                "hidden",
              ]),
        ],
        styles: {
          textAlign: "justify",
          // textJustify: "inter-ideograph",
        },
        children: [
          createActionButton({
            label: "Copy",
            icon: Icons.Copy,
            title: getString("chat-copy-text"),
            onClick: (_e, btn) => {
              const container =
                btn.closest(".items-start") || btn.closest(".items-end");
              const messageEl = container?.querySelector(".chat-message");
              if (messageEl && messageEl.textContent) {
                new ztoolkit.Clipboard()
                  .addText(messageEl.textContent, "text/plain")
                  .copy();
                const span = btn.querySelector(".btn-label");
                if (span) {
                  const originalText = span.textContent;
                  span.textContent = "Copied";
                  setTimeout(() => {
                    span.textContent = originalText;
                  }, 4000);
                }
              }
            },
          }),
          createActionButton({
            label: "COPY MD",
            icon: Icons.Markdown,
            title: getString("chat-copy-markdown"),
            onClick: (_e, btn) => {
              const container =
                btn.closest(".items-start") || btn.closest(".items-end");
              const messageEl = container?.querySelector(".chat-message");
              const markdown =
                (container as HTMLElement)?.dataset?.markdown ||
                (messageEl as HTMLElement)?.dataset?.markdown;

              const textToCopy = markdown || messageEl?.textContent;

              if (textToCopy) {
                new ztoolkit.Clipboard()
                  .addText(textToCopy, "text/plain")
                  .copy();
                const span = btn.querySelector(".btn-label");
                if (span) {
                  const originalText = span.textContent;
                  span.textContent = "Copied";
                  setTimeout(() => {
                    span.textContent = originalText;
                  }, 4000);
                }
              }
            },
          }),
          ...(!isUser
            ? [
                // createActionButton({
                //   label: "NOTE",
                //   icon: Icons.Note,
                //   title: getString("chat-save-as-note"),
                //   // TODO: Add note logic
                //   onClick: (_e, _btn) => {
                //     // Placeholder for NOTE functionality
                //     if (!Zotero.getMainWindow().ZoteroContextPane.activeEditor || !annotation)
                //       return;
                //     annotation.comment = (_btn.closest(".items-start") as HTMLElement).dataset.markdown || "";
                //     addon.data.currentReader?._addToNote([annotation]);
                //   }
                // }),
                createActionButton({
                  label: "Retry",
                  icon: Icons.Redo,
                  title: getString("chat-regenerate-response"),
                  onClick: (_e, _btn) => {
                    if (onRegenerate) onRegenerate();
                  }
                })
              ]
            : []),
        ],
      },
    ],
  });
}

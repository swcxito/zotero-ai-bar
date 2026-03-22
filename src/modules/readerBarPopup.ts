/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * readerBarPopup.ts
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

import { config } from "../../package.json";
import { getSelectionContext } from "../utils/selectionContext";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { aiBarCommands } from "../utils/prompts";
import { AiActionButton } from "../components/aiActionButton";
import { ModelInfo } from "../components/modelInfo";
import { ExpandButton, ExpandMenuItem } from "../components/expandButton";
import { Icons } from "../components/common";

// TODO 等待内容获取完整后再发请求

// TODO 支持其它格式

export function getReaderSourceLabel(
  reader?: _ZoteroTypes.ReaderInstance<"pdf" | "epub" | "snapshot">,
) {
  const isValidTitle = (value?: unknown) => {
    if (typeof value !== "string") return false;
    const text = value.trim();
    if (!text) return false;
    return !/^(pdf|epub|snapshot)$/i.test(text);
  };

  const getItemTitle = (item?: any) => {
    if (!item) return undefined;
    const title =
      item?.getField?.("title") || item?.getDisplayTitle?.() || item?.title;
    return isValidTitle(title) ? String(title).trim() : undefined;
  };

  const getFileName = (item?: any) => {
    if (!item) return undefined;
    const name =
      item?.attachmentFilename ||
      item?.getFilename?.() ||
      item?.getField?.("filename");
    if (typeof name === "string" && name.trim()) return name.trim();

    const filePath = item?.getFilePath?.();
    if (typeof filePath === "string" && filePath.trim()) {
      const normalized = filePath.replace(/\\/g, "/");
      return normalized.split("/").pop() || undefined;
    }

    return undefined;
  };

  const itemID = reader?.itemID;
  if (itemID) {
    const item = Zotero.Items.get(itemID) as any;

    const parentID = item?.parentID || item?.parentItemID;
    const parentItem = parentID
      ? (Zotero.Items.get(parentID) as any)
      : undefined;

    const title = getItemTitle(parentItem) || getItemTitle(item);
    if (title) return title;

    const fileName = getFileName(item);
    if (fileName) return fileName;
  }
  return getString("item-section-head-text");
}

// must call once in main window otherwise CSS file won't be loaded in reader popup
export function registerAIBarStyleSheet(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  const styles = ztoolkit.UI.createElement(doc, "link", {
    properties: {
      type: "text/css",
      rel: "stylesheet",
      href: `chrome://${addon.data.config.addonRef}/content/zoteroAIBar.css`,
    },
  });
  doc.documentElement?.appendChild(styles);
}

export function registerReaderInitializer() {
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    ({ reader, doc, params, append }) => {
      // addon.hooks.onReaderPopupShow(event);
      addon.data.selectedText = params.annotation.text?.trim();
      ztoolkit.log(addon.data.selectedText, "selected");
      if (getPref("extend-selection-context"))
        addon.data.selectionContextPromise = getSelectionContext(
          reader,
          params,
        );
      else addon.data.selectionContextPromise = Promise.resolve(undefined);
      // ztoolkit.log(doc);
      // ztoolkit.log(append);
      // ztoolkit.log("annotation", params.annotation);
      ztoolkit.log("Creating Ask AI Bar");
      addon.chatManager.currentAnnotation = params.annotation;
      addon.chatManager.currentReader = reader;
      if (reader._internalReader._type === "pdf") append(renderAIBar(doc));
    },
    config.addonID,
  );
}

function renderAIBar(doc: Document): DocumentFragment {
  // Insert styles
  if (
    !doc.querySelector(
      `link[href="chrome://${addon.data.config.addonRef}/content/zoteroAIBar.css"]`,
    )
  ) {
    const styles = ztoolkit.UI.createElement(doc, "link", {
      properties: {
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${addon.data.config.addonRef}/content/zoteroAIBar.css`,
      },
    });
    doc.head?.appendChild(styles);
  }

  const disableAll = (container: HTMLElement) => {
    container.querySelectorAll("button, textarea").forEach((el: Element) => {
      (el as HTMLButtonElement | HTMLTextAreaElement).disabled = true;
    });
  };

  const handleAsk = async (
    input: HTMLTextAreaElement,
    container: HTMLElement,
  ) => {
    const text = input.value.trim();
    if (text && addon.data.selectedText) {
      ztoolkit.log("Ask:", text, "Context:", addon.data.selectedText);
      disableAll(container);

      await addon.chatManager.sendChatRequest({
        userPrompt: text,
        selectedText: addon.data.selectedText,
        sourceLabel: getReaderSourceLabel(addon.chatManager.currentReader),
        hostMode: addon.chatManager.getCurrentHostMode(),
        sectionId: addon.chatManager.currentSection,
        isFromPopup: true,
      });

      container.style.display = "none";
    }
  };

  const handleButtonAction = async (commandId: string) => {
    if (!addon.data.selectedText) return;
    ztoolkit.log("Action:", commandId, addon.data.selectedText);

    const command = aiBarCommands[commandId];
    if (!command) {
      ztoolkit.log("Unknown command:", commandId);
      return;
    }

    const prompt = command.getPrompt(Zotero.locale);
    // ztoolkit.log("Generated Prompt:", prompt);

    const requestParams: Parameters<
      typeof addon.chatManager.sendChatRequest
    >[0] = {
      userPrompt: prompt,
      selectedText: addon.data.selectedText,
      sourceLabel: getReaderSourceLabel(addon.chatManager.currentReader),
      hostMode: addon.chatManager.getCurrentHostMode(),
      sectionId: addon.chatManager.currentSection,
      isFromPopup: true,
    };

    // Enable auto-copy for smartCopy command only
    if (commandId === "smartCopy") {
      requestParams.autoCopy = true;
    }

    await addon.chatManager.sendChatRequest(requestParams);
  };

  // Create AI buttons from commands in specific order: explain, translate, smartCopy
  const createCommandButtons = () => {
    const commandOrder = ["explain", "translate", "smartCopy"];
    return commandOrder
      .map((id) => aiBarCommands[id])
      .filter(Boolean)
      .map((command) =>
        AiActionButton({
          label: getString(command.label),
          icon: command.icon,
          onClick: async () => handleButtonAction(command.id),
        }),
      );
  };

  // Build menu items: built-in + user prompts
  const expandMenuItems: ExpandMenuItem[] = [
    {
      id: "summarize",
      icon: aiBarCommands.summarize.icon,
      label: getString(aiBarCommands.summarize.label),
      onClick: () => handleButtonAction("summarize"),
    },
  ];

  // Add user prompts from addon.data.userPrompts
  const userPrompts = addon.data.userPrompts || [];
  for (const up of userPrompts) {
    expandMenuItems.push({
      id: `user-${up.id}`,
      icon: Icons.Sparkle,
      label: up.name,
      onClick: async () => {
        if (!addon.data.selectedText) return;
        await addon.chatManager.sendChatRequest({
          userPrompt: up.prompt,
          selectedText: addon.data.selectedText,
          sourceLabel: getReaderSourceLabel(addon.chatManager.currentReader),
          hostMode: addon.chatManager.getCurrentHostMode(),
          sectionId: addon.chatManager.currentSection,
          isFromPopup: true,
        });
      },
    });
  }

  return ztoolkit.UI.createElement(doc, "fragment", {
    children: [
      {
        tag: "div",
        classList: ["ai-bar-container"],
        children: [
          ModelInfo(),
          ...createCommandButtons(),
          ExpandButton({
            label: getString("reader-bar-expand"),
            menuItems: expandMenuItems,
          }),
          // Ask (Input Group)
          {
            tag: "div",
            classList: ["input-group"],
            children: [
              {
                tag: "textarea",
                properties: {
                  placeholder: getString("reader-bar-ask-placeholder"),
                  rows: 1,
                },
                listeners: [
                  {
                    type: "focus",
                    listener: (e: Event) => {
                      const input = e.currentTarget as HTMLTextAreaElement;
                      // Add overlay element to prevent reader's global keydown handler
                      if (!doc.querySelector(".context-menu-overlay")) {
                        const overlay = doc.createElement("div");
                        overlay.className = "context-menu-overlay";
                        overlay.style.cssText =
                          "position: fixed; inset: 0; pointer-events: none; z-index: -1; opacity: 0;";
                        doc.body.appendChild(overlay);
                      }
                    },
                  },
                  {
                    type: "blur",
                    listener: (e: Event) => {
                      const input = e.currentTarget as HTMLTextAreaElement;
                      if (!input.value) {
                        input.rows = 1;
                        input.style.height = "auto";
                      }
                      // Remove overlay element when textarea loses focus
                      const overlay = doc.querySelector(
                        ".context-menu-overlay",
                      );
                      if (overlay) {
                        overlay.remove();
                      }
                    },
                  },
                  {
                    type: "input",
                    listener: (e: Event) => {
                      const input = e.currentTarget as HTMLTextAreaElement;
                      const group = input.parentElement as HTMLElement;
                      const bar = group.parentElement as HTMLElement;

                      if (input.value.length > 0) {
                        bar.classList.add("has-input");
                      } else {
                        bar.classList.remove("has-input");
                      }

                      // Auto grow height
                      input.style.height = "auto";
                      const newHeight = Math.min(input.scrollHeight, 100);
                      input.style.height = newHeight + "px";
                    },
                  },
                  {
                    type: "keydown",
                    listener: (e: Event) => {
                      const ke = e as KeyboardEvent;
                      // Prevent all keyboard events from bubbling up to parent
                      // This ensures backspace and other keys don't close the popup
                      ke.stopPropagation();
                      ke.stopImmediatePropagation();

                      if (ke.key === "Enter" && !ke.shiftKey) {
                        ke.preventDefault();
                        const input = ke.currentTarget as HTMLTextAreaElement;
                        const bar = input.closest(
                          ".ai-bar-container",
                        ) as HTMLElement;
                        handleAsk(input, bar);
                      }
                    },
                  },
                  {
                    type: "keyup",
                    listener: (e: Event) => {
                      // Also prevent keyup events from bubbling
                      e.stopPropagation();
                      e.stopImmediatePropagation();
                    },
                  },
                ],
              },
              {
                tag: "button",
                classList: ["ai-send-btn"],
                properties: {
                  type: "button",
                  innerHTML: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
                },
                listeners: [
                  {
                    type: "click",
                    listener: (e: Event) => {
                      e.stopPropagation();
                      const btn = e.currentTarget as HTMLButtonElement;
                      const input =
                        btn.previousElementSibling as HTMLTextAreaElement;
                      const bar = btn.closest(
                        ".ai-bar-container",
                      ) as HTMLElement;
                      handleAsk(input, bar);
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * readerItemPane.ts
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

import { getLocaleID } from "../utils/locale";
import { config } from "../../package.json";
import { ChatBox } from "../components/chatBox";
import { renderMarkdown } from "../utils/markdown";
import { streamLLM } from "../utils/llmRequest";
import { InputArea } from "../components/inputArea";

export function injectCSS(doc: Document | ShadowRoot, filename: string) {
  // 获取插件内资源的 URL
  const url = `chrome://${config.addonRef}/content/styles/${filename}`;

  // 防止重复注入
  if (doc.querySelector(`link[href="${url}"]`)) return;

  // 判断是否是 ShadowRoot（通过检查 host 属性而不是 instanceof）
  const isShadowRoot = "host" in doc && !("head" in doc);
  const ownerDoc = isShadowRoot
    ? (doc as any).ownerDocument
    : (doc as Document);

  const link = ownerDoc.createElement("link");
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = url;

  // 处理 ShadowRoot 和 Document 的区别
  if (isShadowRoot) {
    doc.appendChild(link);
  } else {
    (doc as Document).head.appendChild(link);
  }
}

function injectDebugTailwindScript(root: ShadowRoot) {
  const script = root.querySelector("#debug-tailwind-script");
  if (script) {
    script.remove();
  }
  const url = `chrome://${config.addonRef}/content/tailwind.js`;
  const newScript = document.createElement("script");
  newScript.id = "debug-tailwind-script";
  newScript.src = url;
  root.appendChild(newScript);
}

export async function registerReaderItemPaneSection() {
  // Setup LLM callbacks to update UI
  if (!addon.data.sectionMap) {
    addon.data.sectionMap = new Map();
  }

  Zotero.ItemPaneManager.registerSection({
    paneID: "ai-bar-reader",
    pluginID: addon.data.config.addonID,
    header: {
      l10nID: getLocaleID("item-section-head-text"),
      icon: `chrome://${config.addonRef}/content/icons/favicon.svg`,
    },
    sidenav: {
      l10nID: getLocaleID("item-section-sidenav-tooltip"),
      icon: `chrome://${config.addonRef}/content/icons/favicon.svg`,
    },
    // Optional
    bodyXHTML: `<div id="ai-bar-chat-root" 
class="transition-transform duration-300"
style="width: 100%;display: flex;justify-content: start;
flex-direction: column; min-height: 400px;max-height: 100vh; overflow: hidden;gap: 8px;padding-top: 8px">
</div>`,
    // Optional, Called when the section is first created, must be synchronous
    onInit: ({ item }) => {
      // ztoolkit.log("Section init!", item?.id);
    },
    // Optional, Called when the section is destroyed, must be synchronous
    onDestroy: (props) => {
      // ztoolkit.log("Section destroy!");
      // Note: props.item is not available in onDestroy, cleanup is handled in onItemChange
    },
    // Optional, Called when the section data changes (setting item/mode/tabType/inTrash), must be synchronous. return false to cancel the change
    onItemChange: ({ item, setEnabled, tabType }) => {
      ztoolkit.log(`Section item data changed to ${item?.id}`);
      addon.data.currentSection = item?.id;
      setEnabled(tabType === "reader");
      return true;
    },
    // Called when the section is asked to render, must be synchronous.
    onRender: ({
      doc,
      body,
      item,
      setSectionSummary,
      setSectionButtonStatus,
    }) => {
      setSectionSummary("TODO!");
      setSectionButtonStatus("clear", { hidden: true });
    },
    // Optional, can be asynchronous.
    onAsyncRender: async ({
      body,
      doc,
      item,
      setL10nArgs,
      setSectionSummary,
      setSectionButtonStatus,
    }) => {
      if (item && addon.data.sectionMap)
        addon.data.sectionMap.set(item.id, body);
      const root = body.querySelector("#ai-bar-chat-root") as HTMLElement;
      const shadowRoot = root.attachShadow({ mode: "open" });
      resizeReaderItemPaneHeight(body, "fit");

      // 将 CSS 注入到 Shadow DOM 中
      // injectDebugTailwindScript(shadowRoot);
      injectCSS(shadowRoot, "katex.min.css");
      injectCSS(shadowRoot, "katex-swap.min.css");
      injectCSS(shadowRoot, "atom-one.css");
      injectCSS(shadowRoot, `../app.css`);

      const messageContainer = doc.createElement("div");
      messageContainer.classList.add(
        "message-container",
        "flex",
        "flex-col",
        "flex-1",
        "overflow-y-auto",
      );
      shadowRoot.appendChild(messageContainer);
      shadowRoot.appendChild(InputArea(doc));

      const box = ChatBox(doc, undefined, false);
      const box2 = box.querySelector(".chat-message") as HTMLElement;
      const text =
        "Alright, markdown playground mode 🧪✨\nHere's a quick sampler—tell me if this is what you had in mind:\n\n---\n\n# Heading 1\n\n## Heading 2\n\n### Heading 3\n\n**Bold text**\n*Italic text*\n~~Strikethrough~~\n\n> This is a blockquote\n> Still quoting…\n\n---\n\n### Lists\n\n**Unordered**\n\n* Item one\n* Item two\n\n  * Sub-item\n\n**Ordered**\n\n1. First\n2. Second\n3. Third\n\n---\n\n### Code\n\nInline `code` looks like this.\n\nBlock code:\n\n```python\ndef hello():\n    print(\"Hello, markdown!\")\n```\n\n---\n\n### Links & Images\n\n[OpenAI](https://openai.com)\n\n![Placeholder image](https://via.placeholder.com/150)\n\n---\n\n### Tables\n\n| Column A | Column B |\n| -------: | :------- |\n|    Right | Left     |\n|      123 | abc      |\n\n---\n\nIf you're testing something specific (tables rendering, nested lists, emojis, math, etc.), say the word and I'll zero in on it 🔍😊\n";
      box2.innerHTML = await renderMarkdown(text);
      (box as HTMLElement).dataset.markdown = text;
      const actions = box.querySelector(".chat-actions");
      if (actions) actions.classList.remove("hidden");
      // messageContainer.appendChild(box);
      setSectionButtonStatus("test", { hidden: true });
      setSectionButtonStatus("clear", { hidden: false });
    },
    // Optional, Called when the section is toggled. Can happen anytime even if the section is not visible or not rendered
    onToggle: ({ item, body }) => {
      ztoolkit.log("Section toggled!", item?.id);
      resizeReaderItemPaneHeight(body, "fit");
    },
    // Optional, Buttons to be shown in the section header
    sectionButtons: [
      {
        type: "clear",
        icon: "chrome://zotero/skin/16/universal/empty-trash.svg",
        l10nID: getLocaleID("item-section-button-tooltip"),
        onClick: ({ item, paneID }) => {
          const body = addon.data.sectionMap?.get(item.id);
          if (!body) return;

          const root = body.querySelector("#ai-bar-chat-root");
          if (!root || !root.shadowRoot) return;
          const shadowRoot = root.shadowRoot;
          const doc = body.ownerDocument;
          const messageContainer =
            shadowRoot.querySelector(".message-container");
          if (messageContainer) {
            messageContainer.innerHTML = "";
          }
        },
      },
      {
        type: "test",
        icon: `chrome://${config.addonRef}/content/icons/openai.svg`,
        // l10nID: getLocaleID("item-section-example2-button-tooltip"),
        onClick: async ({ item, paneID }) => {
          const body = addon.data.sectionMap?.get(item.id);
          if (!body) return;

          const root = body.querySelector("#ai-bar-chat-root");
          if (!root || !root.shadowRoot) return;
          const shadowRoot = root.shadowRoot;
          const doc = body.ownerDocument;
        },
      },
    ],
  });
}

export function resizeReaderItemPaneHeight(body: HTMLElement,resizePolicy: "maximize"|"fit"="maximize") {
  const itemPaneHeader = body.ownerDocument.querySelector("#zotero-item-pane-header");
  const bottomDist = itemPaneHeader
    ? itemPaneHeader.getBoundingClientRect().bottom
    : 0;
  let sectionHeader = body.previousElementSibling as HTMLElement;
  if (!sectionHeader || !sectionHeader.classList.contains("head")) {
    sectionHeader = sectionHeader.previousElementSibling as HTMLElement;
  }
  const sectionHeaderHeight = sectionHeader ? sectionHeader.offsetHeight : 0;
  const sectionHeaderDist = sectionHeader.getBoundingClientRect().bottom;

  const calcHeight =
    resizePolicy === "maximize"
      ? bottomDist + sectionHeaderHeight + 12
      : sectionHeaderDist + 6;
  const root = body.querySelector("#ai-bar-chat-root") as HTMLElement;
  root.style.height = `calc(100vh - ${calcHeight}px)`;
}

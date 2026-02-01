// TODO：尽量将样式移入 CSS 文件，通过 class 来控制样式，便于维护和适应 Zotero 的明/暗色主题切换。

export function ChatBox(doc: Document, isAgent: boolean = true): Element {
  const roleClassList = isAgent
    ? [
        "chat-pop-agent",
        "bg-rose-50",
        "dark:bg-zinc-800",
        "rounded-tl-none",
        "mr-4",
        "ml-2",
      ]
    : [
        "chat-pop-user",
        "bg-zinc-100",
        "dark:bg-zinc-800/50",
        "rounded-tr-none",
        "ml-4",
        "mr-2",
      ];
  return ztoolkit.UI.createElement(doc, "div", {
    tag: "div",

    classList: [
      ...roleClassList,
      "p-3",
      "rounded-2xl",
      "shadow-md",
      "chat-pop",
      "shadow-r",
      "dark:shadow-zinc-500",
    ],
  });
}

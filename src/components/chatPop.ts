// TODO：尽量将样式移入 CSS 文件，通过 class 来控制样式，便于维护和适应 Zotero 的明/暗色主题切换。

export function ChatPop(doc: Document, isAgent: boolean = true): Element {
  return ztoolkit.UI.createElement(doc, "div", {
    tag: "div",
    styles: {
      // position: "absolute",
      // bottom: "20px",
      borderRadius: isAgent ? "0 8px 8px 8px" : "8px 0 8px 8px",
      boxSizing: "border-box",
      padding: "12px",
      margin: isAgent ? "6px 12px 12px 4px" : "6px 4px 12px 12px",
      // borderWidth: "1px",
      // borderColor: "rgba(0, 255, 0, 0.1)",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
      textAlign: "justify",
      backgroundColor: "rgb(255,243,243)",
    },
  });
}


export function ChatPop(doc: Document, isAgent: boolean = true): Element {
  return ztoolkit.UI.createElement(doc, "div", {
    tag: "div",
    styles: {
      // position: "absolute",
      // bottom: "20px",
      borderRadius: isAgent ? "0 8px 8px 8px" : "8px 0 8px 8px",
      width: "100%",
      padding: "12px",
      margin: isAgent ? "0 12px 12px 0" : "0 0 12px 12px",
      // borderWidth: "1px",
      // borderColor: "rgba(0, 255, 0, 0.1)",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
      textAlign: "justify",
      backgroundColor: "rgb(255,214,216)",
    },
  });
}

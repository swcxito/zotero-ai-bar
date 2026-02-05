import { TagElementProps } from "zotero-plugin-toolkit";

export function IconView(
  iconMarkup: string,
  sizeRem: number = 1,
  extraClasses: string[] = [],
): TagElementProps {
  if (iconMarkup.trim().startsWith("<svg")) {
    return {
      tag: "span",
      namespace: "html",
      styles: {
        width: `${sizeRem}rem`,
        height: `${sizeRem}rem`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: "0",
      },
      classList: extraClasses,
      properties: { innerHTML: iconMarkup },
    };
  }
  return {
    tag: "img",
    namespace: "html",
    styles: {
      width: `${sizeRem}rem`,
      height: `${sizeRem}rem`,
      pointerEvents: "none",
      flexShrink: "0",
    },
    classList: extraClasses,
    properties: { src: iconMarkup },
  };
}

import { TagElementProps } from "zotero-plugin-toolkit";

export function IconView(
  iconMarkup: string,
  sizeRem: number = 1,
  extraClasses: string[] = [],
): TagElementProps {
  let data = iconMarkup;
  if (iconMarkup.trim().startsWith("<svg")) {
    data = `data:image/svg+xml;utf8,${encodeURIComponent(iconMarkup)}`;
  }
  return {
    tag: "object",
    namespace: "html",
    styles: {
      width: `${sizeRem}rem`,
      height: `${sizeRem}rem`,
      pointerEvents: "none",
      flexShrink: "0",
    },
    classList: extraClasses,
    properties: { data: data, type: "image/svg+xml" },
  };
}

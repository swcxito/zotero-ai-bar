import { TagElementProps } from "zotero-plugin-toolkit";
import { IconView } from "./iconView";

export function LogoButton(
  text: string,
  iconUrl?: string,
  onClick?: () => void,
): TagElementProps {
  return {
    tag: "button",
    namespace: "html",
    classList: [
      "flex",
      "w-full",
      "items-center",
      "gap-3",
      "px-4",
      "py-1.5",
      "text-left",
      "text-sm",
      "text-zinc-700",
      "transition-colors",
      "hover:bg-rose-400",
      "hover:text-white",
      "dark:text-zinc-200",
    ],
    children: [
      IconView(iconUrl??'', 1),
      {
        tag: "span",
        namespace: "html",
        properties: { innerText: text },
      },
    ],
    listeners: [
      {
        type: "click",
        listener: onClick,
      },
    ],
    // styles: { width: "100%" }
  };
}

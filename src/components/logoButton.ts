import { TagElementProps } from "zotero-plugin-toolkit";

export function LogoButton(text: string, iconUrl?: string, onClick?: () => void): TagElementProps {
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
      {
        tag: "object",
        namespace: "html",
        classList: ["w-4", "h-4", "flex-shrink-0"],
        properties: { data: iconUrl, type: "image/svg+xml" },
      },
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

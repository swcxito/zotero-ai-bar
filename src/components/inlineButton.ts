import { TagElementProps } from "zotero-plugin-toolkit";
import { Icons } from "./common";

export function InlineButton(onClicked: (e: Event) => void): TagElementProps {
  return {
    tag: "button",
    classList: [
      "w-full",
      "flex",
      "items-center",
      "justify-center",
      "gap-2",
      "py-3",
      "border",
      "border-dashed",
      "border-gray-200",
      "dark:border-zinc-800",
      "rounded-xl",
      "text-xs",
      "text-zinc-700",
      "dark:text-zinc-400",
      "hover:text-rose-600",
      "hover:border-rose-400",
      "hover:bg-rose-50",
      "dark:hover:bg-rose-950",
      "transition-all",
      "duration-200",
      "font-medium",
      "mt-2",
      "mb-4",
    ],
    properties: { innerHTML: Icons.Add + " Add Model" },
    listeners: [
      {
        type: "click",
        listener: onClicked,
      },
    ],
  };
}

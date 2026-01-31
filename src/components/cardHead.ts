import { ElementProps, TagElementProps } from "zotero-plugin-toolkit";
import { getLogoUrl } from "../constants";
import { Icons } from "./common";
import { UserProvider } from "../types";

export function CardHead(
  data: UserProvider,
  onDeleteClicked: () => void,
  onToggleCollapse: (e: Event) => void,
): ElementProps {
  const urlLabel: TagElementProps = {
    tag: "div",
    classList: [
      "text-xs",
      "font-semibold",
      "opacity-60",
      "truncate",
      "cursor-default",
      "text-zinc-700",
      "dark:text-zinc-300",
    ],
    properties: { innerText: data.baseUrl },
  };
  const urlInput: TagElementProps = {
    tag: "input",
    classList: [
      "text-xs",
      "font-semibold",
      "opacity-60",
      "truncate",
      "cursor-default",
      "text-zinc-700",
      "dark:text-zinc-300",
      "rounded-sm",
      "outline-none",
      "focus:ring-1",
      "focus:ring-rose-300",
      "transition-all",
      "duration-200",
      "ease-in-out",
      "px-2",
      "url-input",
    ],
    properties: {
      type: "text",
      value: data.baseUrl || "",
      placeholder: "Base URL",
    },
  };

  return {
    classList: [
      "p-4",
      "flex",
      "items-center",
      "justify-between",
      "bg-zinc-300/80",
      "dark:bg-zinc-700",
      "transition-all",
      "duration-300",
      "gap-4",
      "border-b",
      "border-zinc-300",
      "dark:border-zinc-700/50",
    ],
    children: [
      {
        tag: "div",
        classList: ["flex", "items-center", "gap-4", "flex-1", "min-w-0"],
        children: [
          {
            tag: "object",
            namespace: "html",
            properties: {
              data: getLogoUrl(data.key ?? "favicon"),
              type: "image/svg+xml",
            },
            classList: ["shrink-0", "w-6", "h-6"],
          },
          // text section
          {
            tag: "div",
            classList: [
              "flex",
              "flex-1",
              "flex-col",
              "xl:flex-row",
              "xl:items-center",
              "gap-2",
              "min-w-10",
            ],
            children: [
              data.isCustom ? urlInput : urlLabel,
              {
                tag: "input",
                classList: [
                  "flex-1",
                  "bg-white",
                  "dark:bg-zinc-900",
                  "border",
                  "border-gray-300",
                  "dark:border-zinc-700",
                  "rounded-lg",
                  "px-2",
                  "py-1",
                  "text-sm",
                  "outline-none",
                  "focus:ring-1",
                  "focus:ring-rose-300",
                  "transition-all",
                  "duration-200",
                  "ease-in-out",
                  "key-input",
                ],
                properties: {
                  type: "text",
                  placeholder: "API Key",
                  value: data.apiKey || "",
                },
              },
            ],
          },
          // tail buttons
          {
            tag: "div",
            classList: ["flex", "items-center", "gap-1", "shrink-0"],
            children: [
              {
                tag: "button",
                classList: [
                  "p-2",
                  "text-zinc-500",
                  "hover:text-red-600",
                  "transition-colors",
                  "duration-200",
                  "rounded-lg",
                  "hover:bg-white/50",
                  "dark:hover:bg-red-950",
                ],
                properties: { innerHTML: Icons.Delete },
                listeners: [{ type: "click", listener: onDeleteClicked }],
              },
              {
                tag: "button",
                classList: [
                  "p-2",
                  "text-zinc-500",
                  "hover:text-black",
                  "dark:hover:text-white",
                  "transition-all",
                  "duration-200",
                  "rounded-lg",
                  "hover:bg-white/50",
                  "dark:hover:bg-zinc-800",
                ],
                properties: {
                  innerHTML: `<div class="transition-transform duration-300 ease-in-out">${Icons.Chevron}</div>`,
                },
                listeners: [{ type: "click", listener: onToggleCollapse }],
              },
            ],
          },
        ],
      },
    ],
  };
}

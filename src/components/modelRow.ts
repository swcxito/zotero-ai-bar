import { UserProviderModel } from "../types";
import { Icons } from "./common";

export function CardModelRow(doc: Document, data?: UserProviderModel) {
  const row = ztoolkit.UI.createElement(doc, "div", {
    tag: "div",
    //flex items-center gap-3 p-2 rounded-xl transition-all duration-300 bg-zinc-50 dark:bg-zinc-800  ring-2 ring-rose-100
    classList: [
      "flex",
      "items-center",
      "gap-3",
      "p-2",
      "rounded-xl",
      "transition-all",
      "duration-300",
      "bg-zinc-50",
      "dark:bg-zinc-800",
      "ring-2",
      "ring-rose-100",
    ],
    children: [
      {
        tag: "input",
        classList: [
          "mx-1",
          "w-4",
          "h-4",
          "rounded",
          "border-gray-300",
          "dark:border-zinc-600",
          "cursor-pointer",
          "accent-rose-500",
          "bg-white",
          "dark:bg-zinc-800",
        ],
        properties: { type: "checkbox", checked: data?.enable ?? true },
      },
      {
        tag: "div",
        classList: ["relative", "flex-1", "flex", "items-center"],
        children: [
          {
            tag: "button",
            classList: [
              "p-1.5",
              "mr-2",
              "rounded-md",
              "transition-all",
              "duration-200",
              "shrink-0",
              "text-gray-400",
              "hover:text-rose-400",
              "hover:bg-white",
              "dark:hover:bg-zinc-700",
            ],
            properties: { innerHTML: Icons.QuickInput, title: "Quick Select" },
          },
          {
            tag: "input",
            classList: [
              "flex-1",
              "bg-transparent",
              "text-sm",
              "px-0",
              "outline-none",
              "rounded",
              "focus:ring-1",
              "ring-rose-300",
              "placeholder:text-gray-400",
              "transition-all",
              "duration-200",
              "font-semibold",
            ],
            properties: {
              type: "text",
              placeholder: "Enter model name",
              value: data?.name || "",
            },
          },
        ],
      },
      {
        tag: "button",
        classList: [
          "p-2",
          "text-gray-300",
          "hover:text-red-500",
          "transition-all",
          "duration-200",
          "rounded-lg",
          "shrink-0",
        ],
        properties: { innerHTML: Icons.Delete, title: "Delete Model" },
        listeners: [
          {
            type: "click",
            listener: (e: Event) =>
              (e.currentTarget as HTMLElement).parentElement?.remove(),
          },
        ],
      },
    ],
  });
  (row as any).getData = (): UserProviderModel => {
    return {
      id: data?.id ?? crypto.randomUUID(),
      name: (row.querySelector('input[type="text"]') as HTMLInputElement).value,
      enable: (row.querySelector('input[type="checkbox"]') as HTMLInputElement)
        .checked,
    };
  };
  return row;
}

import {
  UserProviderModel,
  UserProviderConfig,
  UserProvider,
} from "../types";
import { CardHead } from "./cardHead";
import { CardModelRow } from "./modelRow";
import { InlineButton } from "./inlineButton";


export function ProviderCard(data: UserProvider, doc: Document): Node {
  const card = ztoolkit.UI.createElement(doc, "div", {
    classList: [
      "overflow-clip",
      "bg-white",
      "dark:bg-zinc-900",
      "rounded-3xl",
      "shadow-sm",
      "border",
      "border-gray-200",
      "dark:border-zinc-800",
      "transition-all",
      "duration-300",
      "relative",
      "h-fit",
      "provider-card",
    ],
    // children: [headerTag],
  });

  function onDeleteClicked() {
    card.remove();
  }

  const cardBody = ztoolkit.UI.createElement(doc, "div", {
    classList: [
      "grid",
      "transition-all",
      "duration-300",
      "ease-in-out",
      "grid-rows-[1fr]",
      "opacity-100",
    ],
    children: [
      {
        tag: "div",
        classList: ["overflow-hidden"],
        children: [
          {
            tag: "div",
            classList: [
              "text-[10px]",
              "font-bold",
              "text-zinc-400",
              "uppercase",
              "tracking-widest",
              "px-1",
              "m-4",
            ],
            properties: { innerText: "Models" },
          },
          {
            tag: "div",
            classList: ["flex", "flex-col", "gap-2", "px-4", "model-card-list"],
          },
        ],
      },
    ],
  });

  const modelCardList = cardBody.querySelector(".model-card-list");

  data.models?.forEach((model) => {
    if (model.id) {
      const row = CardModelRow(doc, model);
      modelCardList?.appendChild(row);
    }
  });

  const addModelButton = ztoolkit.UI.createElement(
    doc,
    "button",
    InlineButton(() => {
      if (modelCardList) {
        const row = CardModelRow(doc);
        modelCardList.insertBefore(row, addModelButton);
      }
    }),
  );

  let isCollapsed = false;

  function onToggleCollapse(e: Event) {
    const collapseBtn = e.currentTarget as HTMLElement;
    if (cardBody && collapseBtn) {
      if (isCollapsed) {
        cardBody.classList.remove("grid-rows-[0fr]", "opacity-0");
        cardBody.classList.add("grid-rows-[1fr]", "opacity-100");
        collapseBtn.firstElementChild?.classList.remove("rotate-90");
      } else {
        cardBody.classList.remove("grid-rows-[1fr]", "opacity-100");
        cardBody.classList.add("grid-rows-[0fr]", "opacity-0");
        collapseBtn.firstElementChild?.classList.add("rotate-90");
      }
    }
    isCollapsed = !isCollapsed;
  }

  const providerSetting: UserProviderConfig = {
    id: data.id,
    key: data.key,
    name: data.name,
    baseUrl: data.baseUrl ?? "",
    apiKey: data.apiKey ?? "",
    models: data.models ?? [],
    isCustom: data.isCustom,
  };
  (card as any).getData = (): UserProviderConfig => {
    const modelRows = modelCardList?.querySelectorAll(
      "div[class*='model-card-list'] > div",
    );
    const models: UserProviderModel[] = [];
    interface ModelRowElement extends HTMLDivElement {
      getData: () => UserProviderModel;
    }
    modelRows?.forEach((row: Element) => {
      const modelData: UserProviderModel = (row as ModelRowElement).getData();
      if( modelData.id && modelData.name !== "")
        models.push(modelData);
    });
    providerSetting.apiKey = (
      card.querySelector(".key-input") as HTMLInputElement
    ).value;
    providerSetting.models = models;
    if (data.isCustom) {
      providerSetting.baseUrl = (
        card.querySelector(".url-input") as HTMLInputElement
      ).value;
    }
    return providerSetting;
  };

  const header = ztoolkit.UI.createElement(
    doc,
    "div",
    CardHead(data, onDeleteClicked, onToggleCollapse),
  );

  modelCardList?.appendChild(addModelButton);
  card.append(header, cardBody);

  return card;
}

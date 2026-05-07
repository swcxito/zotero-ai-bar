/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * modelDialog.ts
 *
 * This file is part of Zotero AI Bar.
 * Zotero AI Bar - A handy AI assistant integration for Zotero
 *
 * Copyright (c) 2026. swcxito <120201848+swcxito@users.noreply.github.com>
 *
 * Zotero AI Bar is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * Zotero AI Bar is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
 *
 * Repository: https://github.com/swcxito/zotero-ai-bar
 */

import { config } from "../../package.json";
import { ProviderLogoButton } from "../components/buttons/providerLogoButton";
import { ProviderCard } from "../components/providerCard";
import { getV2LogoUrl, findModelMetadata } from "../utils/providers";
import type {
  UserProviderConfigV2,
  AddedProvider,
  AddedModel,
  ProviderId,
} from "../utils/providers";

function buildModelRows(
  v2: UserProviderConfigV2,
  providerId: string,
): { id: string; name: string; enabled: boolean }[] {
  return (v2.addedModels ?? [])
    .filter((m) => m.providerId === providerId)
    .map((m) => ({ id: m.id, name: m.name, enabled: m.enabled }));
}

export async function openDialog(onDialogClosed: () => void = () => {}) {
  const windowArgs = {
    onBodyLoaded: onModelDialogLoad,
    onWindowClosed: onDialogClosed,
  };

  Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/modelDialog.html`,
    `${config.addonRef}-model-dialog`,
    "chrome,centerscreen,resizable,status,dialog=no,width=800,height=600",
    windowArgs,
  );
}

class ModelDialogV2 {
  private readonly doc: Document;
  private readonly root: HTMLElement | null;
  private readonly overlay: HTMLElement | null;
  private readonly addProviderButton: HTMLElement | null;
  private readonly searchInput: HTMLInputElement | null;
  private readonly providerList: HTMLElement | null;
  private readonly customButtonContainer: HTMLElement | null;

  // Pinned to top when search is empty (order = display order)
  private static readonly PINNED_ORDER = [
    "openai",
    "google",
    "anthropic",
    "alibaba-cn",
    "deepseek",
    "moonshotai-cn",
    "minimax-cn",
    "zhipuai",
  ];
  private static readonly PINNED_SET = new Set(ModelDialogV2.PINNED_ORDER);

  constructor(private readonly win: Window) {
    this.doc = win.document;
    this.root = this.doc.querySelector("#root");
    this.overlay = this.doc.querySelector("#add-provider-overlay");
    this.addProviderButton = this.doc.querySelector("#add-provider-button");
    this.searchInput = this.doc.querySelector("#provider-search-input");
    this.providerList = this.doc.querySelector("#add-provider-list");
    this.customButtonContainer = this.doc.querySelector("#add-provider-custom");
  }

  init() {
    if (
      !(
        this.root &&
        this.addProviderButton &&
        this.overlay &&
        this.searchInput &&
        this.providerList
      )
    ) {
      return;
    }

    const v2 = addon.data.userProviderConfigV2!;
    ztoolkit.log("[ModelDialogV2.init] v2 state:", {
      providers: Object.keys(v2.addedProviders),
      models: v2.addedModels.length,
      envKeys: Object.keys(v2.env),
    });

    this.bindPopupShowHide();
    this.renderProviders();
    this.addCards();

    this.win.addEventListener("unload", () => {
      this.saveSettings();
      this.win.arguments[0].onWindowClosed();
    });
  }

  // ---- Card rendering ----

  private addCards() {
    const container = this.root?.querySelector("#provider-block");
    if (!container) return;

    const v2 = addon.data.userProviderConfigV2!;
    const cp = addon.data.commonProviders;

    for (const [providerId] of Object.entries(v2.addedProviders)) {
      this.createAndAppendCard(providerId, container as HTMLElement);
    }
  }

  private createAndAppendCard(providerId: string, container?: HTMLElement) {
    const target = container ?? this.root?.querySelector("#provider-block");
    if (!target) return;

    const v2 = addon.data.userProviderConfigV2!;
    const cp = addon.data.commonProviders;
    const commonProvider = cp?.[providerId];
    const addedProvider = v2.addedProviders[providerId];
    const envKeys = addedProvider?.env ?? commonProvider?.env ?? [];
    const envValues = v2.env[providerId] ?? {};
    const isCustom = !commonProvider;

    ztoolkit.log("[ModelDialogV2] createAndAppendCard:", {
      providerId,
      isCustom,
      envKeys,
      models: buildModelRows(v2, providerId).length,
    });

    const card = ProviderCard({
      providerId,
      providerName: addedProvider?.name ?? commonProvider?.name ?? providerId,
      iconUrl: getV2LogoUrl(providerId),
      baseUrl: commonProvider?.api,
      envKeys,
      envValues,
      isCustom,
      models: buildModelRows(v2, providerId),
      doc: this.doc,
      onDelete: () => this.renderProviders(),
    });

    target.appendChild(card);
  }

  // ---- Add Provider popup ----

  private getExistingProviderIds(): Set<string> {
    const ids = new Set<string>();
    this.root
      ?.querySelectorAll(".provider-card")
      .forEach((card) => ids.add((card as any).getData?.().providerId ?? ""));
    return ids;
  }

  private getAvailableProviders(): Array<[string, { name: string }]> {
    const commonProviders = addon.data.commonProviders;
    if (!commonProviders) return [];
    const existingIds = this.getExistingProviderIds();
    return Object.entries(commonProviders)
      .filter(([id]) => !existingIds.has(id))
      .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }

  private refreshProviderList(query: string = "") {
    if (!this.providerList || !this.customButtonContainer) return;

    const available = this.getAvailableProviders();

    this.providerList.replaceChildren();

    const q = query.toLowerCase().trim();
    let filtered = available;
    if (q) {
      filtered = available.filter(([, p]) => p.name.toLowerCase().includes(q));
    }

    // Split into pinned and rest; pinned only when no search
    const pinned: typeof filtered = [];
    const rest: typeof filtered = [];
    if (!q) {
      for (const entry of filtered) {
        if (ModelDialogV2.PINNED_SET.has(entry[0])) {
          pinned.push(entry);
        } else {
          rest.push(entry);
        }
      }
      pinned.sort(
        (a, b) =>
          ModelDialogV2.PINNED_ORDER.indexOf(a[0]) -
          ModelDialogV2.PINNED_ORDER.indexOf(b[0]),
      );
      ztoolkit.log(
        "[ModelDialogV2.refreshProviderList] pinned:",
        pinned.map(([id]) => id),
        "rest:",
        rest.map(([id]) => id),
      );
    } else {
      rest.push(...filtered);
    }

    const appendButton = (
      providerId: string,
      name: string,
      iconUrl: string,
    ) => {
      const btn = this.doc.createElement("button");
      btn.className =
        "flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm text-zinc-700 transition-colors hover:bg-rose-400 hover:text-white dark:text-zinc-200";
      const img = this.doc.createElement("img");
      img.src = iconUrl;
      img.className = "w-4 h-4 shrink-0";
      btn.appendChild(img);
      const span = this.doc.createElement("span");
      span.textContent = name;
      btn.appendChild(span);
      btn.addEventListener("click", () => {
        this.hidePopup();
        this.addProviderCard(providerId as ProviderId);
        btn.remove();
      });
      this.providerList!.appendChild(btn);
    };

    for (const [id, p] of pinned) {
      appendButton(id, p.name, getV2LogoUrl(id));
    }
    if (pinned.length > 0 && rest.length > 0) {
      const sep = this.doc.createElement("div");
      sep.className = "mx-3 my-1 border-t border-gray-100 dark:border-zinc-700";
      this.providerList.appendChild(sep);
    }
    for (const [id, p] of rest) {
      appendButton(id, p.name, getV2LogoUrl(id));
    }
    ztoolkit.log(
      "[ModelDialogV2.refreshProviderList] DOM children:",
      this.providerList.children.length,
    );

    // Custom provider button at bottom
    this.customButtonContainer.replaceChildren();
    ztoolkit.UI.appendElement(
      ProviderLogoButton({
        text: "Custom Provider",
        iconUrl: `chrome://${config.addonRef}/content/icons/favicon.svg`,
        onClick: () => {
          this.hidePopup();
          this.addCustomProviderCard();
        },
      }),
      this.customButtonContainer,
    );
  }

  private renderProviders() {
    if (!this.searchInput) return;

    this.refreshProviderList();

    this.searchInput.addEventListener("input", () => {
      this.refreshProviderList(this.searchInput!.value);
    });
  }

  private addProviderCard(providerId: string) {
    ztoolkit.log("[ModelDialogV2] addProviderCard:", providerId);
    const v2 = addon.data.userProviderConfigV2!;
    const cp = addon.data.commonProviders?.[providerId];
    if (!v2.addedProviders[providerId] && cp) {
      const { models: _, ...rest } = cp;
      v2.addedProviders[providerId] = rest as AddedProvider;
    }
    this.createAndAppendCard(providerId);
  }

  private addCustomProviderCard() {
    const customId = `custom-${crypto.randomUUID().slice(0, 8)}`;
    ztoolkit.log("[ModelDialogV2] addCustomProviderCard:", customId);
    const v2 = addon.data.userProviderConfigV2!;
    v2.addedProviders[customId] = {
      id: customId as ProviderId,
      name: "Custom Provider",
      env: ["API_KEY"],
    };
    this.createAndAppendCard(customId);
  }

  // ---- Save ----

  private saveSettings() {
    const container = this.root?.querySelector("#provider-block");
    if (!container) return;

    const v2 = addon.data.userProviderConfigV2!;
    const newEnv: UserProviderConfigV2["env"] = {};
    const newAddedModels: AddedModel[] = [];
    const newAddedProviders: Record<string, AddedProvider> = {};

    interface CardWithGetData extends HTMLElement {
      getData: () => {
        providerId: string;
        envValues: Record<string, string>;
        baseUrl?: string;
        models: { id: string; name: string; enabled: boolean }[];
      };
    }

    const cards = container.querySelectorAll(".provider-card");
    cards.forEach((cardElement) => {
      const card = cardElement as CardWithGetData;
      const cardData = card.getData();
      const {
        providerId,
        envValues: cardEnv,
        baseUrl,
        models: cardModels,
      } = cardData;

      ztoolkit.log("[ModelDialogV2.saveSettings] card:", {
        providerId,
        envKeys: Object.keys(cardEnv),
        models: cardModels.map((m) => ({
          id: m.id,
          name: m.name,
          enabled: m.enabled,
        })),
      });

      // Env values
      if (Object.keys(cardEnv).length > 0) {
        newEnv[providerId] = { ...cardEnv };
      }

      // Models
      for (const cm of cardModels) {
        const existing = v2.addedModels.find(
          (m) => m.providerId === providerId && m.id === cm.id,
        );
        if (existing) {
          newAddedModels.push({ ...existing, enabled: cm.enabled });
        } else {
          // New model — search commonProviders for metadata
          const metadata = findModelMetadata(
            cm.name,
            undefined,
            providerId as ProviderId,
            addon.data.commonProviders,
          );
          newAddedModels.push({
            ...(metadata ?? {
              id: cm.name,
              name: cm.name,
              family: "gpt" as import("../utils/providers").ModelFamily,
              reasoning: false,
              temperature: true,
              modalities: {
                input: ["text"],
                output: ["text"],
              } as import("../utils/providers").Modalities,
              open_weights: false,
              cost: { input: 0, output: 0 },
              limit: { context: 0, output: 0 },
            }),
            id: cm.name,
            name: cm.name,
            providerId: providerId as ProviderId,
            enabled: cm.enabled,
          });
        }
      }

      // Provider metadata
      const cp = addon.data.commonProviders?.[providerId];
      if (cp) {
        const { models: _, ...rest } = cp;
        newAddedProviders[providerId] = rest as AddedProvider;
      } else {
        // Custom provider
        newAddedProviders[providerId] = {
          id: providerId as ProviderId,
          name: v2.addedProviders[providerId]?.name ?? providerId,
          env: ["API_KEY"],
          ...(baseUrl ? { api: baseUrl } : {}),
        };
      }
    });

    v2.env = newEnv;
    v2.addedModels = newAddedModels;
    v2.addedProviders = newAddedProviders;

    ztoolkit.log(
      "[ModelDialogV2.saveSettings] new addon.data.userProviderConfigV2:",
      v2,
    );
  }

  // ---- Popup show/hide ----

  private bindPopupShowHide() {
    // Open on button click
    this.addProviderButton?.addEventListener("click", () => {
      this.showPopup();
    });

    // Close on overlay click (click outside the popup panel)
    this.overlay?.addEventListener("click", (event: Event) => {
      if (event.target === this.overlay) {
        this.hidePopup();
      }
    });

    // Close on Escape key
    this.doc.addEventListener("keydown", (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        this.overlay?.classList.contains("opacity-100")
      ) {
        this.hidePopup();
      }
    });
  }

  private hidePopup() {
    if (this.searchInput) this.searchInput.value = "";
    this.overlay?.classList.remove("opacity-100");
    this.overlay?.classList.add(
      "opacity-0",
      "invisible",
      "pointer-events-none",
    );
  }

  private showPopup() {
    this.refreshProviderList();
    this.overlay?.classList.remove(
      "opacity-0",
      "invisible",
      "pointer-events-none",
    );
    this.overlay?.classList.add("opacity-100");
    this.searchInput?.focus();
  }
}

export async function onModelDialogLoad(window: Window) {
  new ModelDialogV2(window).init();
}

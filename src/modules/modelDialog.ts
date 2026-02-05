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

// async function regiestModelDialog()  {
//   const dialog= new ztoolkit.Dialog(
//
//   )
// }

import { config } from "../../package.json";
import { LogoButton } from "../components/logoButton";
import { PROVIDERS } from "../constants";
import { getString } from "../utils/locale";
import { ProviderCard } from "../components/providerCard";
import { UserProviderConfig } from "../types";
import { setPref } from "../utils/prefs";

export async function openDialog(onDialogClosed: () => void = () => {}) {
  // 创建窗口参数
  const windowArgs: {
    onBodyLoaded: any;
    onWindowClosed?: any;
    // data: any;
    // isEdit: boolean;
    // result?: {
    //   success: boolean;
    //   data: any;
    //   isEdit: boolean;
    //   originalKey?: string;
    // };
  } = {
    onBodyLoaded: onModelDialogLoad,
    onWindowClosed: onDialogClosed,
  };

  const dialogWindow = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/modelDialog.html`,
    `${config.addonRef}-model-dialog`,
    "chrome,centerscreen,resizable,status,dialog=no,width=800,height=600",
    windowArgs,
  );
  // addon.data.dialog = {
  //   window: dialogWindow,
  // };
}

export class ModelDialog {
  private readonly doc: Document;
  private readonly root: HTMLElement | null;
  private readonly providerPopup: HTMLElement | null;
  private readonly addProviderButton: HTMLElement | null;

  constructor(private readonly win: Window) {
    this.doc = win.document;
    this.root = this.doc.querySelector(`#root`);
    this.providerPopup =
      this.doc.querySelector<HTMLElement>(`#add-provider-popup`);
    this.addProviderButton = this.doc.querySelector<HTMLElement>(
      `#add-provider-container button`,
    );
  }

  init() {
    if (!(this.root && this.addProviderButton && this.providerPopup)) {
      return;
    }

    this.bindPopupShowHide();
    this.renderProviders();
    // this.renderTestCard();
    this.addCards();

    this.win.addEventListener("unload", () => {
      this.saveSettings();
      this.win.arguments[0].onWindowClosed();
    });
  }

  private saveSettings() {
    const container = this.root?.querySelector("#provider-block");
    if (!container) return;

    const cards = container.querySelectorAll(".provider-card");
    const configs: UserProviderConfig[] = [];

    cards.forEach((card: Element) => {
      if ((card as any).getData) {
        configs.push((card as any).getData());
      }
    });

    if (addon) {
      addon.data.userProviderConfigs = configs;
      ztoolkit.log(
        "Updated addon provider settings:",
        addon.data.userProviderConfigs,
      );
    }
    setPref("llm.providerConfigs", JSON.stringify(configs));
    ztoolkit.log("Saved provider settings:", configs);
  }

  // private renderTestCard() {
  //   // const testProvider: Provider = {
  //   //   id: "test-openai",
  //   //   type: "OpenAI",
  //   //   baseUrl: "https://api.openai.com/v1",
  //   //   apiKey: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  //   //   models: [
  //   //     { id: "1", name: "gpt-4o", enabled: true },
  //   //     { id: "2", name: "gpt-3.5-turbo", enabled: false },
  //   //   ],
  //   //   isCollapsed: false,
  //   // };

  //   const container = this.root?.querySelector("#provider-block");

  //   if (container) {
  //     const card = ProviderCard({
  //       key: "OPENAI",
  //       name: "OpenAI",
  //       baseUrl: "https://api.openai.com/v1",
  //       models: ['gpt-4o', 'gpt-3.5-turbo'],
  //     }, this.doc)
  //     container.appendChild(card);
  //   }
  // }

  private addCards() {
    const container = this.root?.querySelector("#provider-block");

    if (container) {
      for (const config of addon.data.userProviderConfigs || []) {
        const card = ProviderCard(config, this.doc);
        container.appendChild(card);
      }
    }
  }

  private bindPopupShowHide() {
    this.root?.addEventListener("click", (event: { target: any }) => {
      const target = event.target as Node;
      const doesClickInsidePopup = this.providerPopup?.contains(target);
      const doesClickOnButton = this.addProviderButton?.contains(target);

      if (!doesClickInsidePopup && !doesClickOnButton) {
        this.hidePopup();
      }
    });
    this.addProviderButton?.addEventListener("click", () => {
      this.showPopup();
    });
  }

  private hidePopup() {
    this.providerPopup?.classList.remove("opacity-100", "visible");
    this.providerPopup?.classList.add(
      "opacity-0",
      "invisible",
      "pointer-events-none",
    );
  }

  private showPopup() {
    this.providerPopup?.classList.remove(
      "opacity-0",
      "invisible",
      "pointer-events-none",
    );
    this.providerPopup?.classList.add("opacity-100", "visible");
  }

  private renderProviders() {
    if (!this.providerPopup) return;

    this.providerPopup.replaceChildren();
    for (const providerKey in PROVIDERS) {
      if (addon.data.userProviderConfigs?.some((p) => p.id === providerKey)) {
        ztoolkit.log(
          `Provider ${providerKey} already exists in settings, skipping button creation.`,
        );
        continue;
      }
      const provider = PROVIDERS[providerKey as keyof typeof PROVIDERS];
      const name = provider.l10n ? getString(provider.name) : provider.name;
      const b = ztoolkit.UI.createElement(
        this.doc,
        "button",
        LogoButton(
          name,
          `chrome://${config.addonRef}/content/icons/${providerKey.toLowerCase()}.svg`,
          () => {
            this.hidePopup();
            const container = this.root?.querySelector("#provider-block");
            if (container) {
              const card = ProviderCard(
                {
                  id: crypto.randomUUID(),
                  key: providerKey as keyof typeof PROVIDERS,
                  name: name,
                  baseUrl: provider.baseUrl,
                  models: (provider.models || []).map((modelName) => ({
                    name: modelName,
                  })),
                  isCustom: false,
                },
                this.doc,
              );
              container?.appendChild(card);
              b.remove();
            }
          },
        ),
      );
      this.providerPopup.appendChild(b);
      ztoolkit.log("Added provider button:", b);
    }
    ztoolkit.UI.appendElement(
      LogoButton(
        "Custom Provider",
        `chrome://${config.addonRef}/content/icons/favicon.svg`,
        () => {
          this.hidePopup();
          const container = this.root?.querySelector("#provider-block");
          if (container) {
            const card = ProviderCard(
              {
                id: crypto.randomUUID(),
                name: "Custom Provider",
                isCustom: true,
              },
              this.doc,
            );
            container?.appendChild(card);
          }
        },
      ),
      this.providerPopup,
    );
  }
}

export async function onModelDialogLoad(window: Window) {
  new ModelDialog(window).init();
}

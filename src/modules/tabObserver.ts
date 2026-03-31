/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * tabObserver.ts
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

export function registerTabObserver() {
  const observerID = Zotero.Notifier.registerObserver(
    {
      notify: async (event, type, ids, extraData) => {
        if (event === "select" && type === "tab") {
          // 选项卡切换时触发
          ztoolkit.log("Tab switched to:", ids[0]);
          addon.chatManager.currentTabID = ids[0].toString();
        }
      },
    },
    ["tab"], // 监听 tab 类型
    "myObserverID",
  );
}

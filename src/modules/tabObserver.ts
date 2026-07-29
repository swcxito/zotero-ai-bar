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

import { removeSidePaneTab, selectSidePaneTab } from './mainWindowSidePane';

export function registerTabObserver() {
  const observerID = Zotero.Notifier.registerObserver(
    {
      notify: async (event, type, ids, extraData) => {
        if (event === 'select' && type === 'tab') {
          // 选项卡切换时触发
          ztoolkit.log('Tab switched to:', ids[0]);
          addon.chatManager.currentTabID = ids[0].toString();
          selectSidePaneTab(addon.chatManager.currentTabID);
        } else if (event === 'close' && type === 'tab') {
          // 选项卡关闭时移除对应的侧边栏页面 DOM（会话历史保留）
          removeSidePaneTab(ids[0].toString());
        }
      },
    },
    ['tab'],
    'myObserverID'
  );
  addon.data._tabObserverID = observerID;
}

export function getReaderByTabId(id: string) {
  const readers = Zotero.Reader._readers;
  for (const reader of readers) {
    // ztoolkit.log("reader", reader.tabID);
    if (reader.tabID === id) {
      return reader;
    }
  }
  return null;
}

export function getItemIdFromTab(tabId?: string): number | undefined {
  const selectedTabID = tabId || addon.chatManager.currentTabID;
  const reader = selectedTabID ? Zotero.Reader.getByTabID(selectedTabID) : undefined;

  return reader?.itemID;
}

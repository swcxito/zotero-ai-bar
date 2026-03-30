/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * figureContext.ts
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

export async function testImage(item: Zotero.Item) {
  ztoolkit.log("item", item)
  // // 1. 获取附件并读取文件
  // const attachment = await Zotero.Items.getAsync(itemID);
  // if (!attachment.isPDFAttachment()) {
  //   throw new Error(`Item ${itemID} is not a PDF attachment`);
  // }
  // ztoolkit.log(attachment)
  // const path = await attachment.getFilePathAsync();
  // if (!path) {
  //   throw new Error(`Attachment ${itemID} has no valid file path`);
  // }
  //
  // const rawData = await IOUtils.read(path);
}

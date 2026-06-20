/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * citationAction.ts
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

/**
 * Resolve a citation marker target and open it in Zotero's reader.
 *
 * - If `itemId` refers to a regular (parent) item, resolves its best PDF
 *   attachment via `getBestAttachment()`.
 * - If `itemId` refers to a file attachment with a reader type, opens it
 *   directly.
 * - If `page` is provided, navigates the reader to that page (1-based,
 *   converted to `pageIndex` for the reader API).
 *
 * Reuses an already-open reader tab for the same attachment when one exists
 * (handled by `Zotero.Reader.open` with `allowDuplicate: false`).
 */
export async function openCitation(itemId: number, page?: number): Promise<void> {
  try {
    const item = Zotero.Items.get(itemId);
    if (!item) {
      Zotero.debug(`[zaibar-cite] item ${itemId} not in cache; skipping`);
      return;
    }

    let attachmentId: number;
    if (item.isAttachment() && item.attachmentReaderType) {
      attachmentId = itemId;
    } else if (item.isRegularItem()) {
      const attachment = await item.getBestAttachment();
      if (!attachment) {
        Zotero.debug(`[zaibar-cite] no readable attachment for item ${itemId}`);
        return;
      }
      attachmentId = attachment.id;
    } else {
      Zotero.debug(`[zaibar-cite] item ${itemId} is not openable`);
      return;
    }

    // Zotero reader location.pageIndex is 0-based; AI emits 1-based pages.
    const location = page && page > 0 ? { pageIndex: page - 1 } : undefined;

    await Zotero.Reader.open(attachmentId, location, { allowDuplicate: false });
  } catch (error) {
    Zotero.debug(`[zaibar-cite] openCitation failed: ${JSON.stringify(error)}`);
  }
}

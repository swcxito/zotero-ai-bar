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

import { itemAttachments, metadataItem } from '../utils/attachments';
import { getString } from '../utils/locale';
import { promptForAttachment } from '../components/attachmentPicker';
/**
 * Resolve a citation marker target and open it in Zotero's reader.
 *
 * - If `itemId` refers to a regular (parent) item, resolves its readable
 *   default readable attachment. A context-menu action explicitly chooses a file.
 * - If `itemId` refers to a file attachment with a reader type, opens it
 *   directly.
 * - If `page` is provided, navigates the reader to that page (1-based,
 *   converted to `pageIndex` for the reader API).
 *
 * Reuses an already-open reader tab for the same attachment when one exists
 * (handled by `Zotero.Reader.open` with `allowDuplicate: false`).
 */
export async function openCitation(itemId: number, page?: number, chooseAttachment = false): Promise<void> {
  try {
    const item = Zotero.Items.get(itemId);
    if (!item) {
      Zotero.debug(`[zaibar-cite] item ${itemId} not in cache; skipping`);
      return;
    }

    const parent = metadataItem(item);
    const candidates = itemAttachments(chooseAttachment ? parent.id : itemId).filter((entry) => !!entry.attachmentReaderType);
    let defaultAttachment = item.isAttachment() ? item : undefined;
    if (item.isRegularItem()) {
      const best = await item.getBestAttachment();
      if (best && best.attachmentReaderType) defaultAttachment = best;
    }
    defaultAttachment ??= candidates[0];
    const attachment =
      chooseAttachment && candidates.length > 1
        ? promptForAttachment(candidates, getString('attachment-select-message'), undefined, defaultAttachment?.id)
        : defaultAttachment;
    if (!attachment) return;
    const attachmentId = attachment.id;
    // Pages belong to the cited file. A different file chosen explicitly
    // starts at its default location, and non-PDFs never receive PDF pages.
    const changedFile = chooseAttachment && attachmentId !== defaultAttachment?.id;
    const location = !changedFile && attachment.attachmentContentType === 'application/pdf' && page && page > 0 ? { pageIndex: page - 1 } : undefined;

    await Zotero.Reader.open(attachmentId, location, { allowDuplicate: false });
  } catch (error) {
    Zotero.debug(`[zaibar-cite] openCitation failed: ${String(error)}`);
  }
}

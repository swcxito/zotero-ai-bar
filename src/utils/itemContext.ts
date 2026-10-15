/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * itemContext.ts
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

import { creatorNames, metadataItem, resolveAttachment, AttachmentSelectionError } from './attachments';

/**
 * Retrieve metadata for the given Zotero item ID.
 * Returns structured metadata including title, abstract, authors, publication, etc.
 */
export type ItemMetadata = {
  itemId?: number;
  title?: string;
  authors?: string[];
  abstract?: string;
  publication?: string;
  itemType?: string;
  publicationDate?: string;
};

export function getItemMetadata(itemId: number): ItemMetadata | undefined {
  try {
    const item = Zotero.Items.get(itemId);
    if (!item) {
      ztoolkit.log('No item found for tabId:', itemId);
      return undefined;
    }
    ztoolkit.log('Found item for tabId:', itemId, 'item:', item);
    const targetItem = metadataItem(item);

    if (!targetItem.isRegularItem?.()) {
      return undefined;
    }

    // Extract metadata
    // Keep the original itemId (the attachment ID in reader context) so the
    // value injected into the prompt matches what agent tools (grep/read)
    // use as their default. Parent-item fields below are still sourced from
    // the resolved regular item.
    const metadata: ItemMetadata = {};
    metadata.itemId = itemId;

    // Title
    const title = targetItem.getField('title') as string;
    if (title) {
      metadata.title = title;
    }

    // Authors
    const authors = creatorNames(targetItem);
    if (authors.length) metadata.authors = authors;

    // Abstract
    const abstract = targetItem.getField('abstractNote') as string;
    if (abstract) {
      metadata.abstract = abstract;
    }

    // Publication
    const publication =
      (targetItem.getField('publicationTitle') as string) ||
      (targetItem.getField('bookTitle') as string) ||
      (targetItem.getField('journalAbbreviation') as string) ||
      (targetItem.getField('series') as string);
    if (publication) {
      metadata.publication = publication;
    }

    // Item Type
    const itemTypeID = targetItem.itemTypeID;
    if (itemTypeID) {
      const itemType = Zotero.ItemTypes.getLocalizedString(itemTypeID);
      if (itemType) {
        metadata.itemType = itemType;
      }
    }

    // Date
    const date = targetItem.getField('date') as string;
    if (date) {
      metadata.publicationDate = date;
    }

    if (Object.keys(metadata).length === 0) {
      return undefined;
    }

    return metadata;
  } catch (e) {
    ztoolkit.log('getItemMetadata failed:', e);
    return undefined;
  }
}

/**
 * Retrieve the full text of the attachment for the given Zotero item ID.
 * Returns the complete indexed attachment text. Callers that place text in a
 * model prompt must perform their own context-window preflight.
 */
export async function getItemFullText(itemId: number): Promise<string | undefined> {
  try {
    const item = Zotero.Items.get(itemId);
    if (!item) {
      return undefined;
    }

    const targetItem = resolveAttachment(itemId);
    if (!targetItem) return undefined;

    // Try built-in attachment text
    let text: string | undefined;
    const attachmentText = targetItem.attachmentText;
    if (typeof attachmentText === 'string') {
      text = attachmentText;
    } else if (attachmentText && typeof attachmentText.then === 'function') {
      text = await attachmentText;
    }

    if (!text) {
      return undefined;
    }
    return text;
  } catch (e) {
    if (e instanceof AttachmentSelectionError) throw e;
    ztoolkit.log('getItemFullText failed:', e);
    return undefined;
  }
}

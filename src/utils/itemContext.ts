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
    // Get the top-level parent item (not attachment)
    let targetItem = item;
    if (item.isAttachment?.()) {
      const parentID = item.parentID;
      if (parentID) {
        const parentItem = Zotero.Items.get(parentID) as any;
        if (parentItem) {
          targetItem = parentItem;
        }
      }
    }

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
    const creators = targetItem.getCreators?.() || [];
    if (creators.length > 0) {
      const authorNames = creators
        .map((creator: any) => {
          if (creator.firstName && creator.lastName) {
            return `${creator.firstName} ${creator.lastName}`;
          } else if (creator.name) {
            return creator.name;
          } else if (creator.lastName) {
            return creator.lastName;
          }
          return undefined;
        })
        .filter(Boolean);
      if (authorNames.length > 0) {
        metadata.authors = authorNames as string[];
      }
    }

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

    // If this is a regular item (not an attachment), try to get its best attachment
    let targetItem = item;
    if (item.isRegularItem?.() && !item.isAttachment?.()) {
      const attachmentIDs: number[] = item.getAttachments?.() ?? [];
      for (const aid of attachmentIDs) {
        const att = Zotero.Items.get(aid) as any;
        if (att?.attachmentContentType === 'application/pdf' || att?.attachmentContentType?.startsWith('text/')) {
          targetItem = att;
          break;
        }
      }
      if (targetItem === item && attachmentIDs.length > 0) {
        targetItem = Zotero.Items.get(attachmentIDs[0]) as any;
      }
    }

    // Try built-in attachment text
    let text: string | undefined;
    if (typeof targetItem.attachmentText === 'string') {
      text = targetItem.attachmentText;
    } else if (targetItem.attachmentText && typeof targetItem.attachmentText.then === 'function') {
      text = await targetItem.attachmentText;
    }

    if (!text) {
      return undefined;
    }
    return text;
  } catch (e) {
    ztoolkit.log('getItemFullText failed:', e);
    return undefined;
  }
}

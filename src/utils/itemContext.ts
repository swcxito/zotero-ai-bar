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

function getItemFromTab(tabId?: string): any | undefined {
  const selectedTabID = tabId || addon.chatManager.currentTabID;
  const reader = selectedTabID
    ? (Zotero.Reader.getByTabID(selectedTabID) as any)
    : undefined;
  const itemID = reader?.itemID;
  if (itemID) {
    return Zotero.Items.get(itemID) as any;
  }

  return undefined;
}

/**
 * Retrieve metadata for the given Zotero item ID.
 * Returns formatted metadata string including title, abstract, authors, publication, etc.
 */
export function getItemMetadata(tabId: string): string | undefined {
  try {
    const item = getItemFromTab(tabId);
    if (!item) {
      ztoolkit.log("No item found for tabId:", tabId);
      return undefined;
    }
    ztoolkit.log("Found item for tabId:", tabId, "item:", item);
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
    const metadata: Record<string, string | string[]> = {};

    // Title
    const title = targetItem.getField("title") as string;
    if (title) {
      metadata["Title"] = title;
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
        metadata["Authors"] = authorNames;
      }
    }

    // Abstract
    const abstract = targetItem.getField("abstractNote") as string;
    if (abstract) {
      metadata["Abstract"] = abstract;
    }

    // Publication
    const publication =
      (targetItem.getField("publicationTitle") as string) ||
      (targetItem.getField("bookTitle") as string) ||
      (targetItem.getField("journalAbbreviation") as string) ||
      (targetItem.getField("series") as string);
    if (publication) {
      metadata["Publication"] = publication;
    }

    // Item Type
    const itemTypeID = targetItem.itemTypeID;
    if (itemTypeID) {
      const itemType = Zotero.ItemTypes.getLocalizedString(itemTypeID);
      if (itemType) {
        metadata["Item Type"] = itemType;
      }
    }

    // Date
    const date = targetItem.getField("date") as string;
    if (date) {
      metadata["Publication Date"] = date;
    }

    // Build formatted string
    if (Object.keys(metadata).length === 0) {
      return undefined;
    }

    let result = "# Item Metadata\n";
    for (const [key, value] of Object.entries(metadata)) {
      if (Array.isArray(value)) {
        result += `${key}: ${value.join(", ")}\n`;
      } else {
        result += `${key}: ${value}\n`;
      }
    }

    return result.trim();
  } catch (e) {
    ztoolkit.log("getItemMetadata failed:", e);
    return undefined;
  }
}

/**
 * Retrieve the full text of the attachment for the given Zotero item ID.
 * Truncates to 50,000 characters to keep prompts manageable.
 */
export async function getItemFullText(
  tabId: string,
): Promise<string | undefined> {
  try {
    const item = getItemFromTab(tabId) as any;
    if (!item) {
      return undefined;
    }

    // If this is a regular item (not an attachment), try to get its best attachment
    let targetItem = item;
    if (item.isRegularItem?.() && !item.isAttachment?.()) {
      const attachmentIDs: number[] = item.getAttachments?.() ?? [];
      for (const aid of attachmentIDs) {
        const att = Zotero.Items.get(aid) as any;
        if (
          att?.attachmentContentType === "application/pdf" ||
          att?.attachmentContentType?.startsWith("text/")
        ) {
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
    if (typeof targetItem.attachmentText === "string") {
      text = targetItem.attachmentText;
    } else if (
      targetItem.attachmentText &&
      typeof targetItem.attachmentText.then === "function"
    ) {
      text = await targetItem.attachmentText;
    }

    if (!text) {
      return undefined;
    }
    const MAX = 50000;
    return text.length > MAX ? text.slice(0, MAX) + "\n...[truncated]" : text;
  } catch (e) {
    ztoolkit.log("getItemFullText failed:", e);
    return undefined;
  }
}

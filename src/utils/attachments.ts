/** Shared item identity and attachment selection. Never silently choose among several files. */
export function getItem(itemId: number): Zotero.Item | undefined {
  try {
    return Zotero.Items.get(itemId) || undefined;
  } catch {
    return undefined;
  }
}

export function metadataItem(item: Zotero.Item): Zotero.Item {
  const parentId = (item as any).parentItemID || item.parentID;
  return item.isAttachment?.() && parentId ? (getItem(parentId) ?? item) : item;
}

export function creatorNames(item: Zotero.Item): string[] {
  return (item.getCreators?.() ?? [])
    .map((creator: any) => creator.name?.trim() || [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim())
    .filter(Boolean);
}

export function attachmentSource(item: Zotero.Item) {
  return {
    attachmentId: item.id,
    attachmentTitle: String(item.getField('title') || '(no title)'),
    parentItemId: ((item as any).parentItemID || item.parentID || undefined) as number | undefined,
    contentType: item.attachmentContentType || '',
  };
}

export function itemAttachments(itemId: number): Zotero.Item[] {
  const item = getItem(itemId);
  if (!item) throw new Error(`Item not found: ${itemId}`);
  if (item.isAttachment?.()) return [item];
  if (!item.isRegularItem?.()) return [];
  return (item.getAttachments?.() ?? []).map(getItem).filter((entry): entry is Zotero.Item => !!entry && !entry.deleted);
}

export class AttachmentSelectionError extends Error {
  readonly candidates: ReturnType<typeof attachmentSource>[];

  constructor(itemId: number, attachments: Zotero.Item[]) {
    const candidates = attachments.map(attachmentSource);
    super(
      `Item ${itemId} has multiple attachments. Specify an attachment ID before reading or capturing.\n${candidates.map((entry) => `${entry.attachmentTitle} (attachment ID: ${entry.attachmentId})`).join('\n')}`
    );
    this.name = 'AttachmentSelectionError';
    this.candidates = candidates;
  }
}

export function resolveAttachment(itemId: number, kind: 'pdf' | 'text' | 'reader' = 'text'): Zotero.Item | undefined {
  const candidates = itemAttachments(itemId).filter((item) => {
    if (kind === 'pdf') return item.attachmentContentType === 'application/pdf';
    if (kind === 'reader') return !!item.attachmentReaderType;
    const type = item.attachmentContentType || '';
    return (
      ['application/pdf', 'application/epub+zip', 'application/xhtml+xml', 'application/xml'].includes(type) ||
      type.startsWith('text/') ||
      !!item.attachmentReaderType
    );
  });
  if (candidates.length > 1) throw new AttachmentSelectionError(itemId, candidates);
  return candidates[0];
}

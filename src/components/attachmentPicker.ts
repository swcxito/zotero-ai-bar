import { getString } from '../utils/locale';

export function promptForAttachment(
  attachments: readonly Zotero.Item[],
  message: string,
  parentWindow: Window | null = Zotero.getMainWindow(),
  defaultAttachmentId?: number
): Zotero.Item | undefined {
  if (!attachments.length) return undefined;
  const selected = {
    value: Math.max(
      0,
      attachments.findIndex((item) => item.id === defaultAttachmentId)
    ),
  };
  const choices = attachments.map((item) => {
    const title = String(item.getField('title') || '').trim();
    const filename = item.attachmentFilename;
    const label = title && filename && title !== filename ? `${title} — ${filename}` : title || filename;
    return label ? `${label} (#${item.id})` : `#${item.id}`;
  });
  return (Services.prompt as any).select(parentWindow, getString('attachment-select-title'), message, choices, selected)
    ? attachments[selected.value]
    : undefined;
}

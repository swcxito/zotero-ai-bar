import { assert } from 'chai';
import { getSharedToolDefinitions } from '../../src/modules/agentTools';
import { Session } from '../../src/modules/chatManager';

describe('Selected library papers in real Zotero', function () {
  let pane: any;
  let tools: ReturnType<typeof getSharedToolDefinitions>;
  let session: Session;
  const created: number[] = [];
  let first: Zotero.Item;
  let second: Zotero.Item;
  let attachment: Zotero.Item;
  let pdfPath: string;
  let reader: any;

  before(async function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    (globalThis as any).addon = (Zotero as any).ZAIBar;
    (globalThis as any).ztoolkit = addon.data.ztoolkit;
    pane = Zotero.getMainWindow().ZoteroPane;
    tools = getSharedToolDefinitions();
    session = new Session('global-agent-selection-test', { kind: 'global-agent' });
    assert.isUndefined(session.itemId);

    for (const title of ['Selected library paper', 'Other reader paper']) {
      const paper = new Zotero.Item('journalArticle');
      paper.setField('title', title);
      paper.setField('abstractNote', `${title} abstract`);
      await paper.saveTx();
      created.push(paper.id);
      if (!first) first = paper;
      else second = paper;
    }

    // A tiny actual PDF exercises PDFWorker extraction, without a remote fixture.
    const stream = 'BT /F1 12 Tf 72 720 Td (Selected library full text fixture) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    pdfPath = PathUtils.join(PathUtils.tempDir, `zaibar-selection-${Date.now()}.pdf`);
    await Zotero.File.putContentsAsync(pdfPath, pdf);
    attachment = await Zotero.Attachments.importFromFile({ file: pdfPath, parentItemID: first.id });
    const otherAttachment = await Zotero.Attachments.importFromFile({ file: pdfPath, parentItemID: second.id });
    created.push(attachment.id, otherAttachment.id);
  });

  after(async function () {
    if (reader) reader.close();
    for (const id of created.reverse()) {
      if (Zotero.Items.get(id)) await Zotero.Items.erase(id);
    }
    if (pdfPath) await IOUtils.remove(pdfPath, { ignoreAbsent: true });
  });

  async function selected(input = {}) {
    const definition = tools.get_selected_items;
    return definition.execute(definition.inputSchema.parse(input), { experimental_context: session });
  }

  it('reads a real multi-selection from a global session and paginates it', async function () {
    await pane.selectItems([first.id, second.id]);
    const result = await selected({ limit: 1 });
    assert.equal(result.total, 2);
    assert.equal(result.nextOffset, 1);
    assert.lengthOf(result.items, 1);
    assert.include(result.items[0].abstract, 'abstract');
    const next = await selected({ offset: result.nextOffset, limit: 1 });
    assert.notEqual(next.items[0].itemId, result.items[0].itemId);
    assert.isFalse(next.truncated);
  });

  it('passes a selected paper ID to the real read handler and extracts its PDF text', async function () {
    await pane.selectItem(first.id);
    const result = await selected();
    const read = await tools.read.execute({ itemId: result.items[0].itemId, pageNumber: 1 }, { experimental_context: session });
    assert.equal(read.title, first.getField('title'));
    assert.include(read.text, 'Selected library full text fixture');
  });

  it('resolves a selected child attachment to its paper', async function () {
    await pane.selectItem(attachment.id);
    const result = await selected();
    assert.equal(result.total, 1);
    assert.equal(result.items[0].itemId, first.id);
  });

  it('keeps the library selection when a different paper is open in the reader', async function () {
    await pane.selectItem(first.id);
    reader = await Zotero.Reader.open(second.getAttachments()[0]);
    assert.isDefined(reader);
    assert.equal(pane.getSelectedItems()[0].id, second.id, 'Native pane helper follows the reader');
    const result = await selected();
    assert.equal(result.items[0].itemId, first.id, 'Tool must keep the library selection');
    reader.close();
    reader = undefined;
  });

  it('returns an empty selection after clearing the actual library list', async function () {
    pane.itemsView.selection.clearSelection();
    const result = await selected();
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
  });
});

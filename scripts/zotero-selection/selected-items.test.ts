import { assert } from 'chai';
import { getSharedToolDefinitions } from '../../src/modules/agentTools';
import { Session } from '../../src/modules/chatManager';
import { carryGlobalReaderContext, globalReaderContextPrefix, snapshotGlobalReaderContext } from '../../src/utils/globalReaderContext';
import { getPref, setPref } from '../../src/utils/prefs';
import type { UserModelMessage } from 'ai';

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
    tools = getSharedToolDefinitions('global-agent');
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

  it('requires explicit document IDs in the global assistant and retains article defaults', async function () {
    const calls = [
      ['read', { pageNumber: 1 }],
      ['grep', { pattern: 'fixture' }],
      ['capture_page', { pageNumber: 1 }],
    ] as const;
    const article = getSharedToolDefinitions('article');
    for (const [name, input] of calls) {
      assert.isFalse(tools[name].inputSchema.safeParse(input).success);
      assert.isTrue(tools[name].inputSchema.safeParse({ ...input, itemId: attachment.id }).success);
      assert.isTrue(article[name].inputSchema.safeParse(input).success);
    }
    const articleRead = await article.read.execute({ pageNumber: 1 }, { experimental_context: { kind: 'article', itemId: attachment.id } });
    assert.equal(articleRead.attachmentId, attachment.id);
  });

  it('snapshots the selected PDF tab and only adds context when it changes', async function () {
    const tabs = Zotero.getMainWindow().Zotero_Tabs;
    const originalTab = tabs.selectedID;
    const history: UserModelMessage[] = [];
    const readerA = await Zotero.Reader.open(attachment.id);
    try {
      const firstContext = snapshotGlobalReaderContext();
      assert.equal(firstContext?.attachmentId, attachment.id);
      const initial = globalReaderContextPrefix(firstContext, history);
      assert.include(initial, `itemId="${attachment.id}"`);
      history.push({ role: 'user', content: [{ type: 'text', text: initial + 'first question' }] });
      assert.equal(globalReaderContextPrefix(firstContext, history), '');

      const secondAttachment = second.getAttachments()[0];
      reader = await Zotero.Reader.open(secondAttachment);
      const secondContext = snapshotGlobalReaderContext();
      assert.equal(secondContext?.attachmentId, secondAttachment);
      const changed = globalReaderContextPrefix(secondContext, history);
      assert.include(changed, `User switched to the PDF attachment with itemId ${secondAttachment}`);
      assert.include(globalReaderContextPrefix(firstContext, [{ role: 'user', content: changed }]), `itemId="${attachment.id}"`);
      history.push({ role: 'user', content: changed + 'next question' });

      const compacted = carryGlobalReaderContext(history, [{ role: 'user', content: 'follow-up' }]);
      assert.equal(globalReaderContextPrefix(secondContext, compacted), '');
      tabs.select(originalTab);
      assert.isNull(snapshotGlobalReaderContext());
      const left = globalReaderContextPrefix(null, history);
      assert.include(left, 'No current PDF attachment is available.');
      history.push({ role: 'user', content: left + 'back in library' });
      assert.equal(globalReaderContextPrefix(null, history), '');
    } finally {
      tabs.select(originalTab);
      reader?.close();
      reader = undefined;
      readerA?.close();
    }
  });

  it('honors the attachment reading preference on real PDFs and accepts explicit versions', async function () {
    const translated = await Zotero.Attachments.importFromFile({ file: pdfPath, parentItemID: first.id });
    created.push(translated.id);
    translated.setField('title', 'Selected paper-COMPARE');
    await translated.saveTx();
    const preference = getPref('chat.attachmentReadStrategy');
    try {
      const read = (itemId: number) => tools.read.execute({ itemId, pageNumber: 1 }, { experimental_context: session });
      const candidateIds = async () => (await read(first.id)).candidates.map((entry: { attachmentId: number }) => entry.attachmentId);
      setPref('chat.attachmentReadStrategy', 'prefer-original');
      assert.equal((await read(first.id)).attachmentId, attachment.id);
      assert.equal((await read(translated.id)).attachmentId, translated.id);
      setPref('chat.attachmentReadStrategy', 'model-choice');
      assert.sameMembers(await candidateIds(), [attachment.id, translated.id]);

      const another = await Zotero.Attachments.importFromFile({ file: pdfPath, parentItemID: first.id });
      created.push(another.id);
      another.setField('title', 'Comparison of experiments');
      await another.saveTx();
      setPref('chat.attachmentReadStrategy', 'prefer-original');
      assert.sameMembers(await candidateIds(), [attachment.id, another.id]);

      attachment.setField('title', 'Selected paper-mono');
      another.setField('title', 'Selected paper-zh-CN');
      await attachment.saveTx();
      await another.saveTx();
      assert.sameMembers(await candidateIds(), [attachment.id, translated.id, another.id]);
    } finally {
      setPref('chat.attachmentReadStrategy', preference);
    }
  });

  it('prompts once per item and turn in manual mode and returns no text when cancelled', async function () {
    const preference = getPref('chat.attachmentReadStrategy');
    const prompt = Services.prompt;
    const win = Zotero.getMainWindow();
    const originalId = second.getAttachments()[0];
    const turn = new win.AbortController();
    const read = (input: { itemId: number; pageNumber?: number; startLine?: number }, signal = turn.signal) =>
      tools.read.execute(input, { experimental_context: session, abortSignal: signal });
    let prompts = 0;
    let accept = true;
    let chosenId: number | undefined;
    (Services as any).prompt = {
      select: (_parent: Window, _title: string, message: string, labels: string[], choice: { value: number }) => {
        prompts++;
        assert.include(message, 'Other reader paper');
        assert.lengthOf(labels, 2);
        assert.isTrue(labels.some((label) => label.endsWith(`(#${originalId})`)));
        choice.value = labels.findIndex((label) => label.includes(`Other paper-dual`) && label.endsWith(`(#${chosenId})`));
        assert.isAtLeast(choice.value, 0);
        return accept;
      },
    };
    try {
      setPref('chat.attachmentReadStrategy', 'manual-choice');
      assert.equal((await read({ itemId: second.id, pageNumber: 1 })).attachmentId, originalId);

      const translated = await Zotero.Attachments.importFromFile({ file: pdfPath, parentItemID: second.id });
      created.push(translated.id);
      chosenId = translated.id;
      translated.setField('title', 'Other paper-dual');
      await translated.saveTx();

      assert.equal((await read({ itemId: second.id })).itemId, second.id);
      assert.equal((await read({ itemId: originalId, pageNumber: 1 })).attachmentId, originalId);
      assert.equal(prompts, 0);

      const results = await Promise.all([read({ itemId: second.id, pageNumber: 1 }), read({ itemId: second.id, startLine: 1 })]);
      assert.deepEqual(
        results.map((result) => result.attachmentId),
        [translated.id, translated.id]
      );
      assert.equal(prompts, 1);

      accept = false;
      const nextTurn = new win.AbortController();
      const cancelled = await read({ itemId: second.id, pageNumber: 1 }, nextTurn.signal);
      assert.include(cancelled.error, 'cancelled PDF selection');
      assert.notProperty(cancelled, 'text');
      assert.notProperty(cancelled, 'candidates');
      await read({ itemId: second.id, pageNumber: 1 }, nextTurn.signal);
      assert.equal(prompts, 2);
    } finally {
      (Services as any).prompt = prompt;
      setPref('chat.attachmentReadStrategy', preference);
    }
  });
});

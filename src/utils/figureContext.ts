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

import { getReaderByTabId } from "../modules/tabObserver";
// 在插件中加载 pdf-worker
// // 或者如果是在 Zotero 插件环境中
// const { PDFAssembler } = ChromeUtils.importESModule(
//   "chrome://zotero/content/pdf-worker/pdfassembler.js"
// );
// 传统 XPCOM 导入方式
// const { PDFAssembler } = Components.utils.import(
//   "chrome://zotero/content/pdf-worker/pdfassembler.js"
// );
// 在插件中加载 pdf-worker
const pdfWorker = new Worker('chrome://zotero/content/pdf-worker/pdf-worker.js');

export async function testImage() {
  const reader = getReaderByTabId();
  if (reader?._type === "pdf") {
    const pdfReader = reader as _ZoteroTypes.ReaderInstance<"pdf">;
    ztoolkit.log("pdf reader", reader);

    // 1. 获取附件并读取文件
    const attachment = pdfReader._item;
    // const attachment = await Zotero.Items.getAsync(itemID);
    if (!attachment.isPDFAttachment()) {
      throw new Error(`Item  is not a PDF attachment`);
    }
    ztoolkit.log(attachment);
    const path = await attachment.getFilePathAsync();
    if (!path) {
      throw new Error(`Attachment  has no valid file path`);
    }
    const rawData = await IOUtils.read(path);
    // ztoolkit.log(getStructTree(rawData));

    // const iframeWindow = reader._iframeWindow;
    // 通过 wrappedJSObject 访问 reader 内部方法
    // const pdfView = reader?._internalReader
    //   ?._primaryView as _ZoteroTypes.Reader.PDFView;
    // ztoolkit.log("pdfView", pdfView);
    // 获取当前页面的结构树
    // if (pdfView && pdfView._pdfDocument) {
    //   const page = await pdfView._pdfDocument.getPage(3);
    //   ztoolkit.log(page)
    //   const structTree = await page.getStructTree();
    // }
  }
}
// // 获取结构树
// async function getStructTree(pdfBuffer:any) {
//   const pdfAssembler = new PDFAssembler();
//   await pdfAssembler.init(pdfBuffer, "");
//
//   // 获取 PDF 文档对象
//   const pdfDocument = pdfAssembler.pdfManager.pdfDocument;
//
//   // 遍历所有页面获取结构树
//   const structTrees = [];
//   for (let i = 0; i < pdfDocument.numPages; i++) {
//     const page = await pdfDocument.getPage(i + 1);
//     const structTree = await page.getStructTree();
//     if (structTree) {
//       structTrees.push({
//         pageIndex: i,
//         tree: structTree,
//       });
//     }
//   }
//   return structTrees;
// }

根据更深入的搜索，除了之前提到的通过 canvas 渲染获取 PDF 图片的方法外，还有以下几种方法：
1. 通过注释获取图片
   在 Zotero 的注释系统中，图片注释和墨迹注释会生成缩略图：
   // 在 reader.js 中，获取注释信息
   async _getAnnotation(item) {
   let json = await Zotero.Annotations.toJSON(item);
   // json.image 可能包含图片注释的图片数据
   return json;
   }
2. 使用 pdf-worker 渲染注释图片
   Zotero 的 pdf-worker 模块提供了在 Web Worker 中渲染注释为图片的功能：
   // pdf-worker/src/renderer.js
   async function renderImage(pdfDocument, annotation) {
   let { position, color } = annotation;
   let page = await pdfDocument.getPage(position.pageIndex + 1);

   // 创建 canvas 并渲染
   let canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
   let ctx = canvas.getContext('2d', { alpha: false });

   await page.render({
   canvasContext: ctx,
   viewport: viewport
   }).promise;

   // 返回 OffscreenCanvas
   return canvas;
   }
   // 导出为 blob
   export async function renderAnnotations(libraryID, buf, annotations, ...) {
   let canvas = await renderImage(pdfDocument, annotation);
   let blob = await canvas.convertToBlob({ type: "image/png" });
   // ...
   }
3. 通过 PDF.js 内部操作符获取图片信息
   PDF.js 在渲染时会解析 PDF 中的图片操作符（OPS），包括：
   // reader/pdfjs/pdf.js/src/shared/util.js 中的操作符类型
   OPS.paintImageXObject      // 绘制外部图片对象
   OPS.paintImageXObjectRepeat // 重复绘制图片
   OPS.paintImageMaskXObject   // 绘制图片蒙版
   OPS.paintInlineImageXObject // 绘制内联图片
   OPS.paintInlineImageXObjectGroup // 绘制内联图片组
   这些操作符在渲染时会被处理，但你也可以通过 getOperatorList() 获取页面的操作列表来分析图片：
   // 获取页面的操作符列表
   let operatorList = await page.getOperatorList();
   // 分析 fnArray 和 argsArray 中的图片相关操作
   operatorList.fnArray.forEach((fn, i) => {
   if (fn === pdfjsLib.OPS.paintImageXObject) {
   let imageRef = operatorList.argsArray[i][0]; // 图片引用ID
   console.log('Found image reference:', imageRef);
   }
   });
4. 访问 PDF 内部图片资源
   PDF.js 的 PartialEvaluator 会处理 PDF 中的 XObject 图片资源：
   // 在 evaluator.js 中，当遇到 Image 类型的 XObject 时
   if (type.name === "Image") {
   self.buildPaintImageXObject({
   resources,
   image: xobj,
   operatorList,
   cacheKey: name,
   localImageCache,
   localColorSpaceCache,
   });
   }
5. 使用 PDFImage 类处理图片数据
   在 PDF.js 核心中，PDFImage 类处理 PDF 图片的解码：
   // reader/pdfjs/pdf.js/src/core/image.js
   class PDFImage {
   constructor({ xref, res, image, isInline, smask, mask, isMask, ... }) {
   // 处理图片字典中的属性
   this.width = dict.get("W", "Width");
   this.height = dict.get("H", "Height");
   this.filter = dict.get("F", "Filter");
   // 支持多种图片格式：JPXDecode, JBIG2Decode, DCTDecode 等
   }

   async createImageData(forceRGBA = false, isOffscreenCanvasSupported = false) {
   // 创建图片数据
   }
   }
6. 获取 PDF 页面原始数据流
   虽然不推荐，但你可以直接访问 PDF 的内部数据结构来获取图片流：
   // 获取页面的资源字典
   let resources = await page.getResources();
   let xObjects = resources.get("XObject");
   // 遍历 XObject 查找图片
   for (let [name, xobj] of xObjects) {
   if (xobj instanceof Ref) {
   xobj = xref.fetch(xobj);
   }
   let type = xobj.dict.get("Subtype");
   if (type.name === "Image") {
   // 这是一个图片对象
   let width = xobj.dict.get("Width");
   let height = xobj.dict.get("Height");
   let filter = xobj.dict.get("Filter"); // 压缩格式
   // 获取原始图片数据流
   let stream = xobj.stream;
   }
   }
7. 使用 Zotero PDFWorker 获取信息
   Zotero 提供了 PDFWorker 来处理 PDF 相关操作：
   // 获取 PDF 全文（包括图片区域的文本描述）
   let { text, pages } = await Zotero.PDFWorker.getFullText(item.id);
   // 导入/导出注释（可能包含图片）
   await Zotero.PDFWorker.import(item.id);
   await Zotero.PDFWorker.export(item.id, annotations);
   总结
   方法	适用场景	复杂度
   Canvas 渲染	获取页面或区域的视觉呈现	简单
   注释渲染	获取注释（图片/墨迹）的缩略图	中等
   操作符列表分析	分析页面中的图片位置和引用	复杂
   XObject 访问	直接获取 PDF 内部图片资源	复杂（需要访问内部 API）
   PDFImage 处理	解码和处理原始图片数据	复杂（需要深入 PDF.js 核心）
   推荐做法：
- 对于大多数用途，使用 Canvas 渲染（page.render()）是最稳定和简单的方法
- 如果需要处理注释图片，使用 pdf-worker 的 renderAnnotations
- 如果需要分析 PDF 中的图片结构，可以使用 操作符列表

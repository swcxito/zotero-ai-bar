import { assert } from 'chai';
import { renderMarkdown } from '../../src/utils/markdown';
import { updateMarkdownContent } from '../../src/utils/markdownContent';
import { createStreamRenderer } from '../../src/utils/streamRenderer';
import { attachCitationHandlers } from '../../src/modules/chatUI';
import { CHAT_SKINS } from '../../src/utils/chatSkin';

/** Opt in with: pnpm test:codex-zotero --perf. No network or paid API calls. */
describe('API streaming performance in isolated Gecko', function () {
  it('compares full replacement with cached DOM reuse, and measures receive-to-display latency', async function () {
    this.timeout(180000);
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    (globalThis as any).addon = (Zotero as any).ZAIBar;
    (globalThis as any).ztoolkit = addon.data.ztoolkit;
    const doc = Zotero.getMainWindow().document;
    const win = doc.defaultView!;
    const now = () => win.performance.now();
    const host = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
    host.style.cssText = 'position:fixed;top:60px;left:50px;width:600px;height:600px;z-index:99999';
    const shadow = host.attachShadow({ mode: 'open' });
    doc.documentElement.appendChild(host);
    const samples: any[] = [];
    const latency: any[] = [];
    const percentile = (values: number[], fraction: number) =>
      [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
    const median = (values: number[]) => percentile(values, 0.5);
    try {
      for (const file of ['app.css', 'styles/skins.css', 'styles/katex.min.css']) {
        await new Promise<void>((resolve, reject) => {
          const link = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link') as HTMLLinkElement;
          link.rel = 'stylesheet';
          link.href = `chrome://zaibar/content/${file}`;
          link.onload = () => resolve();
          link.onerror = () => reject(new Error(`Failed to load ${file}`));
          shadow.appendChild(link);
        });
      }
      const root = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
      root.className = 'message-container';
      root.style.cssText = 'height:600px;overflow:auto';
      root.innerHTML = '<div class="items-start"><div class="chat-message"><div class="chat-message-content"></div></div></div>';
      shadow.appendChild(root);
      const content = root.querySelector('.chat-message-content') as HTMLElement;
      const paragraph = '这是一段用于测试流式回答的文本，讨论文献分析、实验结果以及研究方法。'.repeat(4);
      const block = `## 实验分析\n\n${paragraph}\n\n公式 $E=mc^2$ 和 $\\alpha+\\beta=1$。\n\n| 方法 | 结果 |\n| --- | --- |\n| A | 0.95 |\n| B | 0.87 |\n\n`;
      for (const skin of ['none', ...CHAT_SKINS]) {
        if (skin === 'none') root.removeAttribute('data-zaibar-skin');
        else root.setAttribute('data-zaibar-skin', skin);
        for (const repeats of [35, 105]) {
          const text = block.repeat(repeats);
          for (let round = 0; round < 2; round++) {
            // Alternate ordering to reduce warm-up/order bias.
            for (const optimized of round ? [true, false] : [false, true]) {
              content.replaceChildren();
              const context = optimized ? new Map() : undefined;
              await Zotero.Promise.delay(32);
              for (let index = 0; index < 20; index++) {
                const start = now();
                const html = await renderMarkdown(text.slice(0, Math.floor(text.length * (0.5 + index / 40))), undefined, context);
                const parsed = now();
                if (optimized) updateMarkdownContent(content, html, attachCitationHandlers);
                else {
                  content.innerHTML = html;
                  attachCitationHandlers(content);
                }
                const patched = now();
                root.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
                content.getBoundingClientRect();
                const laidOut = now();
                samples.push({
                  skin,
                  characters: text.length,
                  optimized,
                  round,
                  index,
                  parse: parsed - start,
                  dom: patched - parsed,
                  layout: laidOut - patched,
                  total: laidOut - start,
                });
                await Zotero.Promise.delay(16);
              }
            }
          }
        }
        // Measure every received delta, including updates coalesced before display.
        content.replaceChildren();
        const context = new Map();
        const source = block.repeat(35);
        const received: { length: number; time: number }[] = [];
        const delays: number[] = [];
        let displayed = 0;
        const renderer = createStreamRenderer(
          async (text, isCurrent) => {
            const html = await renderMarkdown(text, undefined, context);
            if (!isCurrent()) return;
            updateMarkdownContent(content, html, attachCitationHandlers);
            root.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
            content.getBoundingClientRect();
            const committed = now();
            while (displayed < received.length && received[displayed].length <= text.length) delays.push(committed - received[displayed++].time);
          },
          undefined,
          now
        );
        try {
          for (let index = 0; index < 120; index++) {
            const text = source.slice(0, Math.floor(source.length * (0.5 + (index + 1) / 240)));
            received.push({ length: text.length, time: now() });
            renderer.update(text);
            await Zotero.Promise.delay(5);
          }
          await renderer.flush(source);
        } finally {
          renderer.dispose();
        }
        assert.equal(delays.length, received.length);
        latency.push({ skin, deltas: delays.length, p95: percentile(delays, 0.95), max: Math.max(...delays) });
      }
      const summary = ['none', ...CHAT_SKINS].flatMap((skin) =>
        [8155, 24465].map((characters) => {
          const select = (optimized: boolean, key: string) =>
            samples
              .filter((sample) => sample.skin === skin && sample.characters === characters && sample.optimized === optimized)
              .map((sample) => sample[key]);
          const before = median(select(false, 'total'));
          const after = median(select(true, 'total'));
          return {
            skin,
            characters,
            before,
            after,
            improvement: 1 - after / before,
            parse: median(select(true, 'parse')),
            dom: median(select(true, 'dom')),
            layout: median(select(true, 'layout')),
          };
        })
      );
      const report = { summary, latency, samples };
      await IOUtils.writeJSON(PathUtils.join(PathUtils.profileDir, 'api-stream-performance.json'), report);
      for (const row of summary.filter((entry) => entry.characters === 8155))
        assert.isAtLeast(row.improvement, 0.4, `${row.skin}: at least 40% faster`);
      for (const row of latency) assert.isAtMost(row.p95, 100, `${row.skin}: p95 display latency <= 100ms`);
    } finally {
      host.remove();
    }
  });
});

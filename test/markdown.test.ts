import { assert } from 'chai';
import { renderMarkdown } from '../src/utils/markdown';

describe('Markdown CJK bold labels', function () {
  it('renders the screenshot labels as bold without inserting spaces', async function () {
    const labels = ['单片集成：', '倒装芯片封装：', '晶圆键合：'];
    const descriptions = ['重点是“在同一芯片上制造”。', '重点是“用微凸点组装和连接独立芯片”。', '重点是“通过表面键合结合晶圆或器件层”。'];
    const html = await renderMarkdown(labels.map((label, index) => `- **${label}**${descriptions[index]}`).join('\n'));

    assert.include(html, '<ul>');
    labels.forEach((label, index) => {
      assert.include(html, `<li><strong>${label}</strong>${descriptions[index]}</li>`);
    });
    assert.notInclude(html, '**');
  });

  it('handles ordered, nested and loose lists as well as paragraphs', async function () {
    for (const source of ['1. **术语：**解释', '- Parent\n  - **术语：**解释', '- **术语：**解释\n\n- Other', '这是**术语：**解释']) {
      assert.include(await renderMarkdown(source), '<strong>术语：</strong>解释');
    }
  });

  it('preserves quotes, nested emphasis and supplementary CJK characters', async function () {
    assert.include(await renderMarkdown('- **“术语”**解释'), '<strong>“术语”</strong>解释');
    assert.include(await renderMarkdown('- **外层 *内层*：**解释'), '<strong>外层 <em>内层</em>：</strong>解释');
    assert.include(await renderMarkdown('- ***术语：***解释'), '<em><strong>术语：</strong></em>解释');
    assert.include(await renderMarkdown('- **术语：**𠀀解释 **other**'), '<strong>术语：</strong>𠀀解释 <strong>other</strong>');
    assert.include(await renderMarkdown('- **术语：**English'), '<strong>术语：</strong>English');
  });

  it('retains standard emphasis and incomplete or escaped delimiters', async function () {
    assert.include(await renderMarkdown('- **术语：** 解释'), '<strong>术语：</strong> 解释');
    assert.include(await renderMarkdown('- **bold:**text'), '**bold:**text');
    assert.include(await renderMarkdown('- **术语：'), '**术语：');
    assert.include(await renderMarkdown('- \\*\\*术语：\\*\\*解释'), '**术语：**解释');
  });

  it('keeps code, link destinations and raw HTML handling intact', async function () {
    assert.include(await renderMarkdown('`**术语：**解释`'), '<code>**术语：**解释</code>');
    const fenced = await renderMarkdown('```text\n**术语：**解释\n```');
    assert.include(fenced, '**术语：**解释');
    assert.notInclude(fenced, '<strong>');
    assert.include(await renderMarkdown('[link](https://example.org/**术语：**解释)'), `href="${encodeURI('https://example.org/**术语：**解释')}"`);
    assert.include(await renderMarkdown('- **术语：**<b>解释</b>'), '&lt;b&gt;解释&lt;/b&gt;');
  });

  it('renders formulas and citation pills alongside bold labels', async function () {
    const html = await renderMarkdown('- **公式：**这里是 $E=mc^2$ [cite:p2]');
    assert.include(html, '<strong>公式：</strong>这里是');
    assert.include(html, 'class="katex"');
    assert.include(html, 'class="zaibar-cite"');
    assert.include(html, 'data-page="2"');
  });
});

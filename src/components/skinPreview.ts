import { ChatBox } from './chatBox';
import { ToolCallBox } from './toolCallBox';
import { renderMarkdown } from '../utils/markdown';
import { attachCitationHandlers } from '../modules/chatUI';

/** Fixed, local-only conversation used to inspect development skins. */
const PREVIEW_ANSWER = `# 长距离依赖与注意力

Transformer 使用**自注意力**让序列中任意两个位置直接交换信息；它仍然需要位置编码，才能区分词的顺序。[cite:p2]

## 文字与段落

这是*斜体*、**粗体**、***粗斜体***、~~删除线~~、\`行内代码\`、[普通链接](https://example.org)和自动链接 https://example.org。这里有一个换行，
下一行继续说明；H<sub>2</sub>O 展示下标。内联公式 $\\mathrm{Attention}(Q,K,V)$ 应保持清晰。

> 引用：RNN 必须沿时间步传递状态；注意力机制可以直接计算两个位置间的关联。
>
> 第二段用于检查较长引用的背景、边框和文字对比度。

### 列表与任务

- 无序列表第一项
  - 嵌套列表，检查缩进与行距
- 无序列表第二项

1. 有序列表第一项
2. 有序列表第二项

- [x] 已阅读论文
- [ ] 对比不同序列长度

#### 引用与表格

文献定位标记 [cite:p2-3] 和上面的独立引用，分别展示行内及正文中的引用样式。

| 结构 | 信息路径 | 并行性 |
| :--- | ---: | :---: |
| RNN | 随距离增长 | 低 |
| 自注意力 | 直接连接 | 高 |

##### 代码

\`\`\`python
scores = query @ key.T / math.sqrt(dim)
weights = softmax(scores, axis=-1)
context = weights @ value
\`\`\`

###### 公式与媒体

$$
\\operatorname{Attention}(Q,K,V)=\\operatorname{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V
$$

![插件图标](chrome://zaibar/content/icons/favicon.svg)

---

**结论：**单层注意力中的信息传递路径很短，但计算和内存开销仍随序列长度变化。`;

export function createSkinPreview(doc: Document): HTMLElement {
  const container = doc.createElement('div');
  container.classList.add('zaibar-skin-preview', 'message-container');
  container.setAttribute('aria-label', '皮肤预览');

  const note = doc.createElement('div');
  note.classList.add('zaibar-skin-preview-note');
  note.textContent = '视觉预览 · 固定对话内容 · 不写入聊天记录';
  container.appendChild(note);

  const user = ChatBox({ doc, isUser: true }) as HTMLElement;
  const userText = user.querySelector('.chat-message') as HTMLElement;
  userText.textContent = 'Transformer 为什么不需要循环结构？请结合论文解释它处理长距离依赖的优势，并给我一个直观例子。';
  container.appendChild(user);

  const tool = ToolCallBox({
    doc,
    toolName: 'search_papers',
    summary: '已完成 · 找到 3 篇相关文献',
    details: 'Attention Is All You Need (2017)\n相关文献 2 篇\n页码与引用信息已读取',
    isExpanded: true,
  });
  container.appendChild(tool);

  const assistant = ChatBox({ doc }) as HTMLElement;
  const message = assistant.querySelector('.chat-message') as HTMLElement;
  const content = doc.createElement('div');
  content.classList.add('chat-message-content');
  message.appendChild(content);
  assistant.dataset.markdown = PREVIEW_ANSWER;
  assistant.querySelector('.chat-actions')?.classList.remove('hidden');
  container.appendChild(assistant);
  void renderMarkdown(PREVIEW_ANSWER).then((html) => {
    if (!container.isConnected) return;
    content.innerHTML = html;
    attachCitationHandlers(content);
  });

  const shortUser = ChatBox({ doc, isUser: true }) as HTMLElement;
  const shortText = shortUser.querySelector('.chat-message') as HTMLElement;
  shortText.textContent = '再简短总结一下。';
  container.appendChild(shortUser);

  const controls = doc.createElement('div');
  controls.classList.add('zaibar-skin-preview-controls');
  const label = doc.createElement('span');
  label.textContent = '控件状态';
  controls.appendChild(label);
  for (const [text, disabled] of [
    ['主要操作', false],
    ['次要操作', false],
    ['不可用', true],
  ] as const) {
    const button = ztoolkit.UI.createElement(doc, 'button', { namespace: 'html' }) as HTMLButtonElement;
    button.type = 'button';
    button.textContent = text;
    button.disabled = disabled;
    controls.appendChild(button);
  }
  const input = ztoolkit.UI.createElement(doc, 'input', { namespace: 'html' }) as HTMLInputElement;
  input.placeholder = '输入框与焦点状态';
  input.setAttribute('aria-label', '预览输入框');
  controls.appendChild(input);
  container.appendChild(controls);

  const composer = doc.createElement('div');
  composer.classList.add('input-area', 'zaibar-skin-preview-composer');
  const textarea = ztoolkit.UI.createElement(doc, 'textarea', { namespace: 'html' }) as HTMLTextAreaElement;
  textarea.placeholder = '消息输入区预览（不会发送）';
  textarea.setAttribute('aria-label', '预览消息输入区');
  composer.appendChild(textarea);
  const send = ztoolkit.UI.createElement(doc, 'button', { namespace: 'html' }) as HTMLButtonElement;
  send.classList.add('input-send-btn');
  send.type = 'button';
  send.textContent = '发送';
  composer.appendChild(send);
  container.appendChild(composer);
  return container;
}

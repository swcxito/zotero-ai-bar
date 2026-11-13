# Codex App Server 应用接入

此迭代在现有 Codex App Server 后端上增加 ChatGPT 应用工具支持。应用由官方运行时执行；AI Bar 不读取应用 token，也不自行实现 Notion API。

## 使用

1. 安装此版本 XPI，在 AI Bar 的模型管理窗口连接 ChatGPT。
2. 展开 Codex 卡片。「ChatGPT 应用（Agent 模式）」会自动读取一次应用列表，只列出已在 ChatGPT 中连接的应用（以及已勾选但失去访问权限的应用）；目录中其余未连接的应用只显示数量。
3. 找不到 Notion 时，先在 ChatGPT 中连接 Notion，再点击「刷新应用」。
4. 勾选 Notion，选择 Codex 模型并使用 Agent 模式。例如：
   「读取我选中的三篇论文，将方法、训练数据和实验结论的比较追加到 Notion 的文献综述页面，保留已有内容。」
5. 应用工具的参数、结果和错误显示在工具卡片中。运行时要求补充信息或确认时，在对话内回答；需要浏览器连接时，完成后选择继续。

应用选择按 ChatGPT 账号保存在 Zotero 偏好设置中，只对下一轮生效。切换所选应用会创建新的远程会话，并带入已有文字历史。普通阅读和翻译模式不启用应用。改变选择不会中断已经运行的工具；请先停止当前回复。

## 协议与限制

- `app/list`：分页读取目录和访问状态。面板首次显示时按登录读取一次（不强制刷新），「刷新应用」强制刷新。目录中的可访问状态不等于工具一定可调用。
- `app/list/updated`：运行时在非强制的 `app/list` 调用中、给出结果之前推送自己缓存的完整目录，即使这次调用本身失败；强制刷新不推送，启动时也不推送（codex-cli 0.166 实测）。当 chatgpt.com 的应用目录接口返回浏览器验证（HTTP 403 “Enable JavaScript and cookies to continue”）时，AI Bar 会再做一次非强制调用，改用这份推送的目录，并在面板中说明原因。推送的目录在 `account/updated` 时丢弃，之后收到的属于当前登录。
- 完整目录有数千个应用（实测 3717 个），面板只列出已连接的和已勾选的应用；单个格式不合法的条目会被跳过，而不是让整个列表失败。
- `app/installed`：开始模型回合前检查所选应用在实际会话配置中的 `enabled` 和 `callable`。检查失败时明确报错，避免生成未经实际写入的成功说明。
- `item/started` / `item/completed` 的 `mcpToolCall`：显示工具执行记录、成功及错误；重复完成通知不重复显示。
- `mcpServer/elicitation/request`：支持标准 form 和 HTTPS URL 流程，校验标量和枚举数组，串行处理并发提问；取消、过期回合或不兼容的表单不会获得批准。不声明支持 OpenAI 扩展表单。
- 官方应用按会话单独启用；现有任意外部 MCP 服务器仍禁用。不修改用户的共享 `config.toml`，保留原有应用级、工具级和管理员策略。
- 本功能不包含 ChatGPT 应用的嵌入式页面 UI；提供聊天内工具调用和编辑体验。Claude Code 后端不继承这些应用。
- 账号套餐、工作区策略、应用连接和 Codex 版本会影响可用性。旧运行时若不支持这些应用接口，需要更新 Codex；不自动切换 API 计费。

## 验证

```powershell
npm run test:codex
npm run test:claude-code
npm run build
```

自动化测试覆盖应用选择隔离、分页、实际可调用性检查、Agent 模式范围、表单类型和拒绝、取消、过期回合、工具结果和凭据脱敏，以及目录被拦截时改用运行时推送目录、只读取一次和账号切换。它们不能替代使用真实账号的 Notion 写入验收。验收时建议指定测试页面，执行一次追加操作，随后重新读取页面核对内容。

只读诊断（不开始模型回合，不调用任何应用）：

```powershell
node scripts/diagnose-codex-apps.mjs "C:\path\to\codex.exe"
```

它会输出 `app/list` 是否被拦截、目录总数和已连接的应用。用 codex-cli 0.166.0-alpha.5.1 实测：`app/list` 返回 HTTP 403 浏览器验证，回退到推送目录后得到 3717 个应用，其中已连接 GitHub、Gmail、Notion、Sites；在只启用 Notion 的临时会话上，`app/installed` 报告 Notion `enabled: true, callable: true`。

协议参考：[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。

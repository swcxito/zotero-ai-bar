# Zotero AI Bar

[![Zotero 7–10](https://img.shields.io/badge/Zotero-7%E2%80%9310-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![最新 Beta](https://img.shields.io/github/v/release/swcxito/zotero-ai-bar?include_prereleases&label=%E6%9C%80%E6%96%B0%20Beta&style=flat-square)](https://github.com/swcxito/zotero-ai-bar/releases)
[![许可证：AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue?style=flat-square)](../LICENSE)

[English](../README.md) | **简体中文**

Zotero AI Bar 是 Zotero 的 AI 阅读助手。阅读文献时选中文本，即可解释、翻译、总结或提问；需要更多背景时，再让 AI 查阅文档和文库。

[项目网站](https://zotero.fukeke.com/zh-cn/) · [使用文档](https://zotero.fukeke.com/zh-cn/guides/install) · [下载最新 Beta](https://github.com/swcxito/zotero-ai-bar/releases/latest/download/zotero-ai-bar.xpi) · [全部版本](https://github.com/swcxito/zotero-ai-bar/releases)

> **Beta 版本：** 插件仍在积极开发中，最新发布版为预发布版本。安装前请先阅读对应的版本说明；重要资料建议先在独立的 Zotero 配置文件中试用。

![阅读器中的 Zotero AI Bar 划词工具栏](assets/fun-bar.gif)

## 功能一览

- **结合文献阅读。** 选中文本后可快速操作，也可以在「普通、全文、Agent」模式中对话。全文模式附加当前文档；Agent 可搜索和读取文档或 Zotero 文库，也能截取 PDF 页面用于图表分析。
- **按习惯使用。** 在阅读器侧栏或独立窗口中聊天；从输入栏切换模型；使用内置提示词或管理自己的提示词。
- **连接 AI 模型。** 浏览支持的服务商和模型，或配置兼容端点。支持图片输入，以及 Markdown、代码、表格和数学公式渲染。
- **查看每轮用量。** 可重新生成最近的回复；对支持的模型设置思考强度，并查看单次回复的 Token 用量；已知模型上下文窗口时，也会显示当前占用情况。
- **调整界面。** 自定义界面设置，并从可用样式中选择外观。

![服务商和模型配置](assets/providers.png)

## 安装与开始使用

1. 从[最新 Beta 发布页](https://github.com/swcxito/zotero-ai-bar/releases/latest/download/zotero-ai-bar.xpi)下载 `.xpi` 文件，不要解压。
2. 在 Zotero 中打开 **工具 → 附加组件**，点击齿轮菜单并选择 **Install Add-on From File…**。
3. 打开 **编辑 → 设置 → AI 工具栏**，添加服务商并填写 API Key 和模型。
4. 打开文献并选中文本，点击 AI 工具栏中的操作。

请参阅[安装指南](https://zotero.fukeke.com/zh-cn/guides/install)和[添加模型指南](https://zotero.fukeke.com/zh-cn/guides/addmodel)。模型服务的用量和费用由相应服务商按其账号条款计算。

## 实验性功能：Codex 订阅接入

在受支持的 macOS 和 Windows 环境中，Beta 版可连接已安装的 Codex 运行时，并使用符合条件的 ChatGPT 登录。此功能仍属实验性功能，运行时版本需通过安全审计；插件不会内置或自动下载运行时。启用前请阅读 [Codex 接入说明](codex-integration.md)。

## 界面预览

| 阅读器操作 | 上下文设置 | 富文本回复 |
| --- | --- | --- |
| ![阅读器工具栏](assets/fun-bar.gif) | ![启用上下文](assets/fun-context-use-zh.png) | ![Markdown 和公式渲染](assets/fun-style.png) |

## 兼容性与帮助

- 支持 Zotero 7 至 10。
- 安装和使用问题请查阅[项目文档](https://zotero.fukeke.com/zh-cn/)，Bug 和功能建议请提交到 [GitHub Issues](https://github.com/swcxito/zotero-ai-bar/issues)，版本变化请查看 [GitHub Releases](https://github.com/swcxito/zotero-ai-bar/releases)。
- 欢迎参与贡献，详见 [CONTRIBUTING](../CONTRIBUTING.md)（[中文](CONTRIBUTING_zh-CN.md)）。

## 支持开发

如果 Zotero AI Bar 对你的研究有帮助，欢迎点亮 GitHub ⭐ 或赞助项目，支持后续维护。

[![爱发电](assets/afdian-btn-zh.png)](https://afdian.com/a/fukeke) [![Buy Me a Coffee](assets/red-button.png)](https://www.buymeacoffee.com/fukeke)

## 致谢

本项目使用了 [Zotero](https://www.zotero.org)、[Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template)、[Vercel AI SDK](https://github.com/vercel/ai) 和 [models.dev](https://github.com/anomalyco/models.dev)，部分实现参考了 [Zotero PDF Translate](https://github.com/windingwind/zotero-pdf-translate) 与 [Zotero PDF2zh](https://github.com/guaguastandup/zotero-pdf2zh)。

## 许可证

本项目采用 [AGPL-3.0-or-later](../LICENSE) 许可证。

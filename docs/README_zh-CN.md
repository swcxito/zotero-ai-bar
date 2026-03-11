# Zotero AI Bar

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org) [![zotero target version](https://img.shields.io/badge/Zotero-8-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org) [![Release](https://img.shields.io/github/release/swcxito/zotero-ai-bar?style=flat-square)](https://github.com/swcxito/zotero-ai-bar/releases)

[English](../README.md) | **简体中文**

一款美观便捷的 Zotero AI 插件，让 AI 助手住在你的手边。

您可以访问 [**项目主页**](https://zotero.fukeke.com/zh-cn/) 了解更多信息及详细教程。

## 赞助

如果你觉得这个项目对你有帮助，欢迎通过以下方式赞助，支持我继续开发和维护这个项目：

[<img alt="爱发电" src="/docs/assets/afdian-btn-zh.png" height="60px"/>](https://afdian.com/a/fukeke)
[<img alt="&amp;amp;quot;Buy Me A Coffee&amp;amp;quot;" height="60px" src="/docs/assets/red-button.png"/>](https://www.buymeacoffee.com/fukeke)

## v0.4.0 计划更新内容

以下内容基于 `v0.3.4` 之后的提交整理：

- 新增自定义提示词管理与独立提示词编辑页面。
- 新增智能复制能力，优化回复交互体验。
- 新增公式块优化选项，提升公式显示与处理体验。
- 重构聊天请求与状态管理，引入 `ChatManager` 并调整请求模块结构。
- 新增独立聊天窗口能力及窗口托管模块。
- 新增界面设置选项，优化整体界面一致性。
- 持续优化提示词与样式细节。

## v0.3 更新说明

- 工具栏上的模型选择器，无需打开设置页面即可切换模型。
  ![img.png](assets/img.png)

- 针对失败请求的重试按钮，无需重新输入提示词。
  ![img.png](assets/retry.png)

- 持续扩展并优化供应商与模型支持，包括对 Qwen 与 MiniMax 的兼容适配。
- 提升 Zotero 7 兼容性，修复注册参数相关问题。
- 新增流式更新速度设置，并补充对应本地化文案。
- 持续优化提示词策略与选中文本分析能力。
- 优化公式渲染与多处 UI/组件细节，提升稳定性与一致性。

## 功能介绍

**把复杂的工作交给我们，简单的操作留给你自己**

### 划词工具栏

一划，一点，让 AI 助手帮你搞定：
![function click](assets/fun-bar.gif)

### 上下文提取

自动提取文献中的关键信息，回答更准确

开启提取：

![img.png](assets/fun-context-use-zh.png)

关闭提取：

![img.png](assets/fun-context-unuse-zh.png)

### 完善美观的富文本

标题、**加粗**、_斜体_、~~删除线~~、`代码块`、[链接](https://github.com/swcxito/zotero-ai-bar/)、引用块、列表......

基础的`Markdown`，它都好看：

![function](assets/fun-style.png)

当然，公式也少不了：
![img.png](assets/fun-math.png)

### 现代的界面设计

丝滑流畅的动效，更多动效开发中！
![export-1770358524964.gif](assets/fun-animate.gif)

深色模式、浅色模式随心切换：
![function dark mode](assets/fun-dark.gif)

## 使用教程

以下为快速教程，详细教程请访问[官网](https://zotero.fukeke.com/zh-cn/)：

1. 安装插件
2. 打开模型设置
3. 添加供应商，填写 API Key 和 model
4. 关闭模型设置页，设置会自动保存
5. 开始使用吧！

说明：当前请求为互斥模式。发起新请求会取消上一个流式请求。

## 开发计划

- [x] ~~基础功能~~
- [x] ~~完善美观的富文本~~
- [x] ~~现代的界面设计~~
- [x] ~~多语言支持（中英文）~~
- [x] ~~基础设置~~
- [x] ~~文档~~
- [ ] 美化工具栏
- [ ] 工具链模型选择
- [x] ~~自定义提示语~~
- [ ] 添加笔记
- [ ] 重新回复
- [x] ~~独立窗口选项~~
- [ ] 连续对话
- [ ] 附件支持
- [ ] 新建对话
- 更多功能正在路上……

## 贡献

欢迎任何形式的贡献！无论是代码、文档、测试，还是建议和反馈，都非常欢迎！详见 [CONTRIBUTING](../CONTRIBUTING.md) ([中文](CONTRIBUTING_zh-CN.md)) 文件。

## 致谢

本项目基于以下项目开发：<br/>
[![Zotero](https://img.shields.io/badge/Zotero-CC2936?style=flat&logo=zotero)](https://www.zotero.org) [![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat&logo=github)](https://github.com/windingwind/zotero-plugin-template)

本项目参考了以下项目的部分实现：<br/>
[![GitHub Repo stars](https://img.shields.io/github/stars/windingwind/zotero-pdf-translate?label=zotero-pdf-translate&style=flat&logo=github)](https://github.com/windingwind/zotero-pdf-translate) [![GitHub Repo stars](https://img.shields.io/github/stars/guaguastandup/zotero-pdf2zh?label=Zotero%20PDF2zh&style=flat&logo=github)](https://github.com/guaguastandup/zotero-pdf2zh)

## 许可证

本项目采用 AGPL3.0 许可证，详情请查看 [LICENSE](../LICENSE) 文件。

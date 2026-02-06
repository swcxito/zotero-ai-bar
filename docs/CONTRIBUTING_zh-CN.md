# 贡献指南

[CONTRIBUTING Guide in English](../CONTRIBUTING.md)

首先，感谢你抽出时间为 Zotero AI Bar 做出贡献！🎉

这份指南旨在帮助你参与到 Zotero AI Bar 的开发中来。这主要是一些建议，并非硬性规定。请运用你的判断力，并且欢迎随时提交 Issue 来改进这份文档。

## 我该如何参与？

### 💡 提出改进建议 (Enhancements)

如果你有好的点子，欢迎提出！

- **清晰的标题**：请用简练的语言描述你的建议。
- **详细描述**：请详细说明你建议的功能或改进点，如果可能，请提供具体的使用场景。
- **解释价值**：说明这个改进为什么有用，它能解决什么问题。

### 🐛 报告 Bug (Reporting Bugs)

遇到问题了？请告诉我们。

- **先搜索**：在提交新 Issue 之前，请先检查一下是否已经有人报告过类似的问题。
- **清晰的标题**：用一句话概括遇到问题。
- **复现步骤**：详细列出复现 Bug 的步骤，越详细越好。
- **环境信息**：请提供你的 Zotero 版本、插件版本以及操作系统信息。
- **提交 Issue**：[![GitHub Issues](https://img.shields.io/github/issues-raw/swcxito/zotero-ai-bar?style=flat&logo=github)](https://github.com/swcxito/zotero-ai-bar/issues)

### 🛠️ 提交代码 (Pull Requests)

想直接贡献代码？太棒了！请遵循以下流程：

1. **Fork** 本仓库，并从 `main` 分支创建你的功能分支。
2. 如果你添加了新功能，请尝试添加相应的**测试用例**（如果适用）。
3. 确保所有测试都通过。
4. 确保代码通过 ESLint 检查。
5. 提交 Pull Request！

## 💻 开发环境搭建

### 前置要求

- [Node.js](https://nodejs.org/en/) (v16 或更高版本)
- [pnpm](https://pnpm.io/) (推荐使用，也支持 npm/yarn)
- [Zotero](https://www.zotero.org/) 7+

### 安装步骤

1. 克隆仓库：

   ```bash
   git clone https://github.com/swcxito/zotero-ai-bar.git
   cd zotero-ai-bar
   ```

2. 安装依赖：

   ```bash
   pnpm install
   ```

### 构建与调试

- **构建插件**：

  ```bash
  pnpm build
  ```

  构建产物位于 `build/` 目录下。

- **开发模式 (热重载/自动构建)**：

  ```bash
  pnpm dev
  ```

  这会监听文件变化并自动重新构建。

### 代码规范

本项目使用 ESLint 和 Prettier 来保持代码风格一致。在提交代码前，请运行：

```bash
pnpm lint:check
```

## 📄 许可证

参与贡献即表示你同意你的代码遵循本项目的 [LICENSE](../LICENSE)。

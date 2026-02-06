# Contributing to Zotero AI Bar

[中文版贡献指南](docs/CONTRIBUTING_zh-CN.md)

First off, thanks for taking the time to contribute! 🎉

The following is a set of guidelines for contributing to Zotero AI Bar. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in an issue.

## How Can I Contribute?

### Suggesting Enhancements

- **Use a clear title**: Provide a descriptive title for the suggestion.
- **Provide a step-by-step description**: Explain the suggested enhancement in detail.
- **Explain why this enhancement would be useful**: Describe the benefits of the enhancement.

### Reporting Bugs

- **Check existing issues**: Before creating a new issue, please verify if your issue has already been reported.
- **Use a clear title**: Provide a descriptive title for the issue.
- **Describe the reproduction steps**: Explain how to reproduce the bug in detail.
- **Provide environment info**: Include your Zotero version and plugin version.
- **Open a new issue**: [![GitHub Issues or Pull Requests](https://img.shields.io/github/issues-raw/swcxito/zotero-ai-bar?style=flat&logo=github)](https://github.com/swcxito/zotero-ai-bar/issues)

### Pull Requests

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. Ensure the test suite passes.
4. Make sure ESLint passes.
5. Issue that pull request!

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/en/) (v16 or higher)
- [pnpm](https://pnpm.io/) (Recommended)
- [Zotero](https://www.zotero.org/) 7+

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/swcxito/zotero-ai-bar.git
   cd zotero-ai-bar
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

### Building

To build the project:

```bash
pnpm build
```

This will generate a `.xpi` file in the `.scaffold` directory, which you can install into Zotero.

### Development Mode

To start the development server with hot-reload support (if applicable):

```bash
pnpm start
```

## Style Guide

We use **ESLint** and **Prettier** to maintain code quality and consistency.

- Run lint check: `pnpm lint:check`

Please ensure your code is formatted correctly before submitting a PR.

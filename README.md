# Zotero AI Bar

[![Zotero 7–10](https://img.shields.io/badge/Zotero-7%E2%80%9310-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Latest beta](https://img.shields.io/github/v/release/swcxito/zotero-ai-bar?include_prereleases&label=Latest%20beta&style=flat-square)](https://github.com/swcxito/zotero-ai-bar/releases)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue?style=flat-square)](LICENSE)

**English** | [简体中文](docs/README_zh-CN.md)

An AI reading companion for Zotero. Select text in a paper to explain, translate, summarize, or ask a question—then bring in more context when you need it.

[Project website](https://zotero.fukeke.com) · [Documentation](https://zotero.fukeke.com/en/guides/install) · [Download the latest beta](https://github.com/swcxito/zotero-ai-bar/releases/latest/download/zotero-ai-bar.xpi) · [All releases](https://github.com/swcxito/zotero-ai-bar/releases)

> **Beta:** Zotero AI Bar is actively developed. The latest release is a pre-release; review its release notes before installing it in a primary Zotero profile.

![The Zotero AI Bar selection toolbar in the reader](docs/assets/fun-bar.gif)

## What you can do

- **Read in context.** Select text for quick actions, or chat in Normal, Full Text, and Agent modes. Full Text includes the current document; Agent can search and read the document or Zotero library and capture PDF pages for visual questions.
- **Choose how you work.** Use the reader sidebar or a separate chat window, switch models in the input bar, and organize repeat tasks with built-in or custom prompts.
- **Connect your model.** Browse supported providers and models, or configure a compatible custom endpoint. Image input, Markdown, code, tables, and math rendering are supported.
- **Track each response.** Retry the latest answer, set reasoning effort where supported, and see per-response token usage; known context windows also show current usage.
- **Make it yours.** Adjust the interface and choose from the available visual styles.

![Provider and model configuration](docs/assets/providers.png)

## Install and get started

1. Download the `.xpi` file from [the latest beta release](https://github.com/swcxito/zotero-ai-bar/releases/latest/download/zotero-ai-bar.xpi). Keep the file compressed.
2. In Zotero, open **Tools → Add-ons**, select the gear menu, and choose **Install Add-on From File…**.
3. Open **Edit → Settings → AI Bar**, add a provider, and configure its API key and model.
4. Open a paper, select text, and choose an action from the AI toolbar.

See the [installation guide](https://zotero.fukeke.com/en/guides/install) and [model setup guide](https://zotero.fukeke.com/en/guides/addmodel) for details. Provider usage is billed by the provider under your account terms.

## Experimental: Codex subscription integration

On supported macOS and Windows setups, the beta can connect to an installed Codex runtime and use an eligible ChatGPT sign-in. This integration is experimental, has a restricted audited runtime allowlist, and does not bundle or automatically download a runtime. Read the [Codex integration notes](docs/codex-integration.md) before enabling it.

## Screenshots

| Reader actions | Context controls | Rich responses |
| --- | --- | --- |
| ![Reader toolbar](docs/assets/fun-bar.gif) | ![Context enabled](docs/assets/fun-context-use.png) | ![Markdown and math rendering](docs/assets/fun-style.png) |

## Compatibility and support

- Supports Zotero 7 through 10.
- Get installation help in the [documentation](https://zotero.fukeke.com), report bugs or request features in [GitHub Issues](https://github.com/swcxito/zotero-ai-bar/issues), and review changes in [GitHub Releases](https://github.com/swcxito/zotero-ai-bar/releases).
- Contributions are welcome. See [CONTRIBUTING](CONTRIBUTING.md) ([中文](docs/CONTRIBUTING_zh-CN.md)).

## Support development

If Zotero AI Bar helps your work, a GitHub star or a contribution helps keep it maintained.

[![Afdian](docs/assets/afdian-btn-en.png)](https://afdian.com/a/fukeke) [![Buy Me a Coffee](docs/assets/red-button.png)](https://www.buymeacoffee.com/fukeke)

## Acknowledgements

Built with [Zotero](https://www.zotero.org), [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template), [Vercel AI SDK](https://github.com/vercel/ai), and [models.dev](https://github.com/anomalyco/models.dev). Parts of the implementation were inspired by [Zotero PDF Translate](https://github.com/windingwind/zotero-pdf-translate) and [Zotero PDF2zh](https://github.com/guaguastandup/zotero-pdf2zh).

## License

Zotero AI Bar is licensed under [AGPL-3.0-or-later](LICENSE).

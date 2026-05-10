# Zotero AI Bar

[![zotero target version](https://img.shields.io/badge/Zotero-7--9-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Release](https://img.shields.io/github/release/swcxito/zotero-ai-bar?style=flat-square)](https://github.com/swcxito/zotero-ai-bar/releases)

**English** | [简体中文](docs/README_zh-CN.md)

A beautiful and handy AI toolbar plugin for Zotero, putting an AI assistant right at your fingertips.

You can visit the [**Project Homepage**](https://zotero.fukeke.com) for more information and detailed tutorials.

## Support

If you find this project helpful, please consider supporting its development and maintenance:

[<img alt="&quot;Buy Me A Coffee&quot;" height="60px" src="docs/assets/red-button.png"/>](https://www.buymeacoffee.com/fukeke)
[<img alt="Afdian" src="docs/assets/afdian-btn-en.png" height="60px"/>](https://afdian.com/a/fukeke)

## What's New in v1.0-beta

### New Provider & Model Architecture

- Out-of-the-box support for **27 providers** and **763+ models**.
- **Native SDK dispatch**: Adapt native AI SDKs for major providers, improving compatibility and resolving past provider issues.
- **Multi-env support (in development)**: Providers with multiple environment variables (e.g., Azure) show separate input fields in the configuration dialog.
- **Provider & model browser**: Browse providers and models with search, quickly add models without tedious manual entry.

### Other Improvements

- **Custom prompt management**: Dedicated prompt editor page with drag-to-reorder support.
- **Smart copy** feature.
- **Standalone chat window** with host mode integration.
- **Formula/Code/Table block optimization** to prevent overflow and interface distortion.

## Features

**Leave the complex work to us, keep the simple operations for yourself.**

### Quick Model Configuration

Easily add and manage AI models through a simple configuration interface, supporting a variety of providers and model choices:
![img.png](docs/assets/providers.png)

A model selector on the toolbar lets you switch models without opening the settings page.
![model-sel.png](docs/assets/model-sel.png)

### Selection Toolbar

Swipe, click, and let the AI assistant handle it for you:
![function click](docs/assets/fun-bar.gif)

### Context Extraction

Automatically extract key information from literature for more accurate answers.

Enable extraction:

![img.png](docs/assets/fun-context-use.png)

Disable extraction:

![img.png](docs/assets/fun-context-unuse.png)

### Beautiful Rich Text

Headings, **bold**, _italics_, ~~strikethrough~~, `code blocks`, [links](https://github.com/swcxito/zotero-ai-bar/), blockquotes, lists...

Basic `Markdown` rendering that looks great:

![function](docs/assets/fun-style.png)

Of course, math formulas are also supported:
![img.png](docs/assets/fun-math.png)

### Modern Interface Design

Smooth and fluid animations, with more on the way!
![export-1770358524964.gif](docs/assets/fun-animate.gif)

Switch between Dark Mode and Light Mode at will:
![function dark mode](docs/assets/fun-dark.gif)

## Usage

Here is a quick tutorial. For detailed instructions, please click and visit the project [homepage](https://zotero.fukeke.com)

1. Install the plugin.
2. Open the model settings.
3. Add a provider, enter your API Key and select a model.
4. Close the settings page; configurations are saved automatically.
5. Start using it!

## Roadmap

- [x] ~~Basic Features~~
- [x] ~~Beautiful Rich Text~~
- [x] ~~Modern Interface Design~~
- [x] ~~Multi-language Support (English/Chinese)~~
- [x] ~~Basic Settings~~
- [x] ~~Documentation~~
- [x] Beautify Toolbar
- [x] ~~Custom Prompts~~
- [x] ~~Standalone Window Option~~
- [x] Continuous Conversation
- [x] New Chat Session
- [ ] Regenerate Response
- [ ] Attachment Support
- And more...

## Contribution

Contributions of any kind are welcome! Whether it's code, documentation, testing, suggestions, or feedback. See [CONTRIBUTING](CONTRIBUTING.md) ([中文](docs/CONTRIBUTING_zh-CN.md)) for details.

## Acknowledgements

This project is built based on:<br/>
[![Zotero](https://img.shields.io/badge/Zotero-CC2936?style=flat&logo=zotero)](https://www.zotero.org) [![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat&logo=github)](https://github.com/windingwind/zotero-plugin-template) [![GitHub Repo](https://img.shields.io/badge/GitHub-models.dev-blue?logo=github)](https://github.com/anomalyco/models.dev) [![GitHub Repo](https://img.shields.io/badge/GitHub-AI%20SDK-blue?logo=github)](https://github.com/anomalyco/models.dev)

Inspired by parts of the implementation from:<br/>
[![GitHub Repo stars](https://img.shields.io/github/stars/windingwind/zotero-pdf-translate?label=zotero-pdf-translate&style=flat&logo=github)](https://github.com/windingwind/zotero-pdf-translate) [![GitHub Repo stars](https://img.shields.io/github/stars/guaguastandup/zotero-pdf2zh?label=Zotero%20PDF2zh&style=flat&logo=github)](https://github.com/guaguastandup/zotero-pdf2zh)

## License

This project is licensed under the AGPL3.0 License. See the [LICENSE](LICENSE) file for details.

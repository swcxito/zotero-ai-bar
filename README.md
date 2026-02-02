# Zotero AI Bar

A handy AI assistant integration for Zotero 7. This plugin brings LLM capabilities directly into your Zotero workflow.

## Features

- 🤖 **AI Integration**: Chat with AI models directly within Zotero.
- 📝 **Rich Text Support**: Full Markdown rendering support.
- 🧮 **Math Equations**: LaTeX math rendering using KaTeX.
- 💻 **Code Highlighting**: Syntax highlighting for code blocks.
- 🎨 **Modern UI**: Clean interface built with Tailwind CSS.
- 🌐 **Multi-language**: Support for English and Chinese.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (Latest LTS recommended)
- [Zotero](https://www.zotero.org/) 7+

### Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/swcxito/zotero-ai-bar.git
   cd zotero-ai-bar
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   pnpm install
   ```

### Build & Run

To start the development server (watches for changes):

```bash
npm start
```

To build the plugin (`.xpi` file):

```bash
npm run build
```

The built `.xpi` file will be located in the `xpi/` directory (or root depending on build config), which you can install into Zotero via `Tools` -> `Add-ons` -> `Install Add-on From File`.

## License

This project is licensed under the [AGPL-3.0 License](LICENSE).

# Claude Code integration (local experimental build)

This change adds an independent `claude-code-local` provider to Zotero AI Bar.
It runs the user's unmodified, separately installed official Claude Code CLI.
Sign in using the official CLI's own authentication flow. AI Bar does not read,
copy, store or exchange OAuth tokens. This adapter checks for a `claude.ai`
login and does not fall back to API-key billing. Claude's own subscription
limits and any extra usage settings still apply.

## Requirements

- Zotero and a working AI Bar build from this source tree.
- A native Claude Code executable (`claude.exe` on Windows).
- A subscription login in the official Claude Code CLI. Run `claude` in a
  terminal to sign in; `claude auth status --json` should report
  `loggedIn: true` and `authMethod: "claude.ai"`.
- A CLI version supporting the required flags. Detection checks capabilities,
  not just a hardcoded version. Local diagnostics were checked with 2.1.168.

## Build and install

From this repository, with Node.js 22.18+ (Node 24 recommended) and pnpm:

```powershell
pnpm install --frozen-lockfile
pnpm test:claude-code
pnpm build
```

The dependency lockfile is unchanged. No new third-party dependency is added.
Install the generated `.xpi` under `.scaffold/build` using Zotero's
Tools > Plugins > Install Plugin From File. This is a local development build,
not a published upstream release. It retains the original plugin ID and
version; installing it replaces the original AI Bar installation and an
upstream update can replace these changes. To roll back, install the original
upstream XPI. This patch does not change library records or credentials.

## Set up

1. Open AI Bar's model manager (Edit Models).
2. Find the **Claude Code** panel.
3. Leave the executable path blank for automatic detection, or select the
   native executable. Windows `.cmd`, `.bat` and `.ps1` wrappers are not
   supported; install the official native CLI if needed.
4. Click **Check login and enable / 检查登录并启用**.
5. Close the model manager and choose **Claude Code · sonnet** in the chat's
   model menu. `opus` and `haiku` aliases are also provided; availability is
   determined by your Claude account, not guaranteed by this list.
6. Choose Normal or Full Text mode, then ask about the selected passage/paper.

Removing the provider only removes its AI Bar configuration and stops its
running subprocesses; it does not log you out of the official CLI.

## Supported behavior

- Selection questions, full-text questions and multi-turn conversations using
  AI Bar's existing local history.
- Inline PNG/JPEG/WebP/GIF image data sent through stdin; local image paths and
  remote image URLs are rejected rather than silently dropped.
- Streaming text, cancellation, bounded diagnostic output and a ten-minute
  request timeout.
- Translation cards, including alternative translation model selection.
- Existing AI Bar history and export/sync behavior applies to completed turns.
  This change introduces no independent cloud conversation store.

### Agent mode

Agent mode gives the model AI Bar's own Zotero tools (`ask_user`, `grep`,
`read`, `get_selected_items`, `glob`, `tree`, `search_papers`, `add_paper`,
`translate`, `capture_page`), the same handlers the API and Codex backends use.

- The tools are served as an in-process ("sdk") MCP server named `zotero`, the
  Claude Agent SDK's protocol: the CLI sends `mcp_message` control requests on
  stdout and AI Bar answers on stdin. No port, HTTP server or extra process is
  involved, and the model sees the tools as `mcp__zotero__<name>`.
- `--allowedTools mcp__zotero` pre-approves exactly that server under
  `--permission-mode dontAsk`. Claude Code's built-in file, shell and web tools
  remain disabled (`--tools=`), and `--strict-mcp-config` ignores any other
  configured MCP servers.
- Arguments are validated with each tool's schema before any Zotero access. A
  turn may make at most 30 tool calls, and an identical repeated `add_paper`
  call returns the first result instead of adding the paper twice.
- Each assistant message is rendered as its own block, so text written after a
  tool call appears below that tool's card. `capture_page` also returns the
  page image to the model.
- Normal and Full Text modes stay tool-free, as with API models.

## Execution design

- Gecko's `Subprocess` launches the native executable directly, without a shell.
- The working directory is a dedicated folder under the Zotero profile.
- Each request sends the current AI Bar history over stdin, and does not reuse
  a hidden Claude session. Clear, retry and switching papers therefore use
  exactly the history AI Bar supplies. `--no-session-persistence` avoids an
  additional CLI transcript. No promise of cost-free/unlimited use is made.
- Built-in tools, discovered MCP servers, hooks, slash commands, Chrome
  integration and auto memory are disabled for these reading requests.
- `--bare` is deliberately not used: it disables subscription authentication.
- The adapter does not inherit API keys or provider overrides. Login remains
  managed by the official CLI. Normal OS, proxy, CA and Claude config-directory
  environment variables are retained.
- Claude destination proxy settings are resolved through Zotero. HTTP/HTTPS
  proxies are supported; differing rules for the API and login destinations
  produce a diagnostic rather than silently choosing a route.
- Stream errors are reported without automatic model retries or API fallback.

## Validation and remaining checks

`pnpm test:claude-code` uses Node's built-in test runner and TypeScript stripping;
it does not require package installation. It covers protocol chunk boundaries,
Unicode, image/history input, auth detection, cancellation/cleanup, error paths,
backend rendering, translation and Agent-mode tool calls (MCP handshake, tool
validation, limits, images and stream segments) with mocked subprocess and UI
boundaries. These tests are not a live Zotero integration test.

The development environment verified that the installed official CLI reports
a Pro subscription. Network restrictions prevented installing npm dependencies,
so the full build/typecheck and actual Zotero UI/model round trip have **not**
been verified here. Before treating the build as ready for everyday use:

1. Run `pnpm build` and the project's normal lint checks after dependencies are installed.
2. In Zotero, test one selection, a full-text question and a screenshot.
3. Ask a follow-up, retry it, stop a response, then clear the conversation.
4. Test translation with and without an alternative model.
5. Reopen Zotero and verify the selected provider/history remains available.

## 中文快速说明

先在终端运行 `claude`，通过官方流程登录 Pro 账号。构建并安装插件后，
进入 AI Bar 的模型管理，找到 Claude Code 面板，点击“检查登录并启用”。
回到聊天窗口选择 Claude 模型，可使用普通、全文或 Agent 模式。Agent 模式下模型
只能使用 AI Bar 的文献库工具，Claude Code 自带的文件和命令工具保持关闭。
对话不会自动同步到 Claude 网页聊天记录。
模型请求仍受你订阅的额度及官方额外用量设置约束。

## References

- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/legal-and-compliance
- https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-max-or-ultra-plan

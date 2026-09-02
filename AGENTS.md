# Project Agent Instructions

## Release workflow

Before releasing, commit all intended tracked changes and leave unrelated untracked files untouched.

To publish the next patch version non-interactively, run:

```bash
pnpm release patch --yes
```

The scaffold release command updates `package.json`, creates a `chore(publish): release vX.Y.Z` commit, creates the matching `vX.Y.Z` tag, and pushes the branch and tag to the configured remote.

Use `minor` or `major` instead of `patch` only when that version bump is explicitly requested.

After the command completes, verify the result with:

```bash
git status --branch --short
git log -3 --oneline
git tag --points-at HEAD
```

Pushing the version tag triggers `.github/workflows/release.yml`, which builds the XPI and creates the GitHub Release through the Zotero plugin reusable release workflow.

### Post-release confirmation

Do not report a release as complete immediately after the release command pushes the branch and tag. Confirm the remote workflows and published artifact with:

```bash
gh run list --workflow ci.yml --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId,status,conclusion,url
gh run list --workflow release.yml --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId,status,conclusion,url
gh release view "$(git tag --points-at HEAD)" --json tagName,isDraft,isPrerelease,assets,url
```

Wait for both returned workflow runs to finish, using `gh run watch <run-id> --exit-status` when needed. A release is confirmed only when:

- Both `CI` and `Release` have `status: completed` and `conclusion: success`.
- The GitHub Release exists for the new tag, is neither a draft nor a prerelease, and includes `zotero-ai-bar.xpi`.

If either workflow fails, inspect the failed job and its annotations or logs, fix the cause, and publish the next patch version. Do not move or overwrite an already-pushed version tag unless explicitly requested.

## XML-safe icons in Zotero native UI

This rule applies to UI injected into Zotero-owned documents, including the main window, side panes, reader UI, and other native Zotero surfaces. It does not apply to plugin-owned windows created from the add-on's own HTML/XHTML pages, although reusing the same helpers there is allowed.

When adding an icon or interactive icon control to Zotero native UI, follow the project's existing XML-safe creation path:

- Create HTML controls as DOM nodes with `ztoolkit.UI.createElement(..., { namespace: 'html' })`; do not inject interactive elements such as `<button>` through `innerHTML`, because Zotero's sanitizer removes them.
- Render icons with `IconView({ iconMarkup: Icons.* })`. `IconView` is the project-level path for preparing SVG-backed icons for Zotero's XML/XHTML environment; do not place raw `<svg>` strings directly into Zotero native UI or manually add SVG `xmlns` attributes to rendered HTML strings.
- If surrounding content must first be rendered with `innerHTML` (for example Markdown), output an inert placeholder such as `<span>`, then hydrate it with the DOM-created control and `IconView` after insertion.
- Run hydration after every relevant native-UI render path and mark placeholders with `data-bound` so repeated or streaming renders are idempotent.
- Mark non-content controls with `data-zaibar-copy-ignore` and `user-select: none` when they appear inside selectable chat content.

Plugin-owned windows loaded from the add-on's own HTML/XHTML files are exempt from this native-UI requirement.

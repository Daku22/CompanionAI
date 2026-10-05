# Security

CompanionAI lets an AI model propose actions on your computer. That makes
security part of the design, not an afterthought. This page explains what the
app can and cannot do, and how to report a problem.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
private reporting instead: on the repository page, open the **Security** tab
and choose **Report a vulnerability**. You will get an answer within a week.
Once a fix is released, the report can be made public with credit to you, if
you want it.

Useful details: the app version (in the installer name, or in Windows
Settings → Apps),
what an attacker needs (a malicious model response? a file on disk?), and the
steps to reproduce.

## What the AI can do on your computer

The model answers with a JSON "action". The main process validates it
(`src/main/guards.js`) **before** showing you a confirmation dialog, and the
dialog shows what will actually run. Nothing external happens without your
click on "Approve".

| Action | What is allowed |
|---|---|
| `open-url` | `http` and `https` links only |
| `open-path` | Existing absolute paths. Executables, scripts and shortcuts are refused |
| `open-desktop-item` | Items inside your Desktop folder. Shortcuts (`.lnk`, `.url`) yes, executables and scripts no |
| `run-command` | Only `notepad`, `calc`, `mspaint` and `explorer`, by bare name. `explorer` only opens folders |
| `look` | A screenshot shown as a preview; it is sent only with your next message |
| `tool` | Only the actions you ticked, of connectors you added and turned on. Arguments are checked against the tool's schema, and a permission dialog shows the connector, the action and its arguments. Only read-only actions can be set to "don't ask again" |

**Connectors (MCP).** A connector is a server you add yourself: a remote URL
(https only, plain http only on `localhost`) or a local command. Nothing is
added or started on its own. Sign-in tokens are encrypted with `safeStorage`
in `~/.desktop-companion/mcp-secrets.json` and never reach the renderer.
What a connector's tools return is data for the model, never an action by
itself. The built-in catalog leaves out services that move money.

`run-command` can be widened with `"allowUnsafeCommands": true` in
`~/.desktop-companion/config.json`. This is **not recommended**: it lets the
model propose any command, and you are then the only safeguard. The flag can
only be set by editing the file by hand. The app's own settings UI cannot
change it.

## How the app is hardened

- **Renderer isolation:** `contextIsolation` and `sandbox` are on, and
  `nodeIntegration` is off. The only bridge is `src/main/preload.js`.
- **IPC checks:** every IPC channel accepts messages only from the app's own
  pages.
- **Content Security Policy:** no inline scripts, no `eval`, nothing loaded
  from the network. The one script from outside the app files is the Live2D
  Cubism Core, downloaded by the user: `live2d://` serves only that file, and
  only while it still has the expected SHA-256.
- **Blocked browsing:** navigation and new windows are blocked, and browser
  permissions (camera, notifications, location…) are denied. The only
  exception is the microphone: audio only, for the app's own pages, and only
  while it is turned on in the settings.
- **API keys:** encrypted with the operating system's key store (Electron
  `safeStorage`). They are never sent back to the renderer.
- **Custom protocols:** `vrm://` and `avatar://` serve files only from their
  own folders. Path traversal is refused.
- **Packaged app:** built with Electron Fuses. Run-as-Node, `NODE_OPTIONS` and
  inspector flags are disabled, and the app only loads from its integrity-checked
  `app.asar`.

## What stays on your computer

See [PRIVACY.md](PRIVACY.md). In short: conversations go only to the AI
provider you choose, and everything else stays local.

## Supported versions

Only the latest release receives security fixes.

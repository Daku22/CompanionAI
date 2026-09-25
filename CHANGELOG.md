# Changelog

## 1.0.0 — first public release

### Avatars
- Built-in avatar: Fred (3D, VRM 1.0), with procedural animations. VRM 1.0
  models now face the camera with their arms down.
- Import your own VRM, GLB/glTF or 2D sprite packs. Only the files a model
  declares are copied, and folder scanning has limits.
- New 2D pipeline: `npm run strips` turns master sheets into sprite packs and
  finds the frames automatically. Frames are capped at 480 px, which cuts
  video memory by about 7×.
- In 3D mode, a handle lets you move the window.

### AI and memory
- Seven providers: OpenRouter, Claude, ChatGPT, Grok, Gemini, Mistral, Ollama.
  OpenRouter and Ollama model lists are fetched live.
- Provider errors are explained in plain words: wrong key, no credit, missing
  model, rate limit.
- Models that reason before answering get enough token budget and time.
- Memory:
  - survives long chats;
  - summarizes old turns in chunks instead of dropping them;
  - never summarizes the same turn twice;
  - is saved atomically.
- Clearing the chat no longer erases memory. "Dimentica tutto" does, after
  confirmation.

### Security
- System actions are validated before the confirmation dialog:
  - `run-command` accepts only bare allowlisted names;
  - `explorer` opens only folders;
  - executables and scripts are never opened.
- Settings sent from the UI cannot enable unsafe commands.
- Every IPC channel checks its sender, and all browser permissions are denied.
- Content Security Policy without inline scripts or `eval`.
- Packaged with Electron 44 and Electron Fuses.

### Distribution
- Windows installer (NSIS), built and published by GitHub Actions with
  SHA-256 checksums.
- Optional start with Windows, and an error log file with no telemetry.
- Code under the MIT License. Asset licenses listed in `ASSETS-LICENSE.md`.

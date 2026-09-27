# Changelog

## 1.0.0 — first public release

### Avatars
- Built-in avatar: Fred (3D, VRM 1.0), with procedural animations. VRM 1.0
  models now face the camera with their arms down.
- Import your own VRM, GLB/glTF or 2D sprite packs. Only the files a model
  declares are copied, and folder scanning has limits.
- Imported avatars can be selected and deleted from the menu.
- Mood: six emotions that fade at their own pace, set by an optional
  `emotion` field in the reply and shown in the chat. The model is told the
  mood, the time of day and how long since the last message.
- Idle life: when nobody is chatting the avatar looks around, walks a little,
  hums, and dozes off when you are away. No model calls. Toggle: "Vita autonoma".
- 3D: time-based blinking (it depended on the frame rate), small eye saccades,
  and a faint mood expression under the reaction ones.
- New 2D pipeline: `npm run strips` turns master sheets into sprite packs and
  finds the frames automatically. Frames are capped at 480 px, which cuts
  video memory by about 7×.
- In 3D mode, a handle lets you move the window.

### AI and memory
- Seven providers: OpenRouter, Claude, ChatGPT, Grok, Gemini, Mistral, Ollama.
  OpenRouter and Ollama model lists are fetched live.
- Provider errors are explained in plain words: wrong key, no credit, missing
  model, rate limit.
- Models that reason before answering get enough token budget and time,
  including models from the live OpenRouter list.
- OpenRouter: the reply format follows what each model supports (JSON schema,
  JSON mode, or a forced tool call). Models with tools but no JSON mode, such
  as Laguna S 2.1, used to answer in prose, and the avatar ignored requests
  like "walk to the right".
- Walking can go left, right or toward the mouse, over a short or medium
  distance or to the screen edge. "Sit here" keeps the avatar seated for three
  minutes.
- The chat says so when a model does not answer in the companion's format,
  after one automatic retry with a format reminder.
- An API key that cannot be decrypted on this PC is kept in the config instead
  of being erased by the next save, and the setup screen asks to enter it
  again.
- 2D speech bubbles come from the sprite pack; other avatars get neutral ones.
- Dragging ends when the mouse button is released. The 3D camera can only turn
  a little, so the model stays in view.
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

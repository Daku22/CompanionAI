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
- Mouse, in the spirit of Mate Engine (ideas only, no code):
  - clicks on the transparent parts of the window go through to the windows
    below;
  - grab the avatar itself to move it. It sways on a damped spring driven by
    the window's speed, and in 3D the spring bones (hair, clothes) are pushed
    by the motion. The 3D camera no longer turns, and the drag handle is gone;
  - in 3D, head, neck and spine turn toward the cursor within limits, and the
    eyes follow it; in 2D the sprite faces the cursor's side;
  - click for a small reaction, double-click to open the chat;
  - right-click menu: chat, avatars, window size, follow the mouse, idle life,
    always on top, hide, quit.
- The window starts in the right place when the taskbar is on the top or left.
- Animations in one format, `.vrma`, on every humanoid model:
  - GLB/glTF and FBX avatars with a human skeleton are now animated like VRM
    ones. Bones are recognized from the names used by Mixamo, VRoid, Unreal,
    Blender Rigify, 3ds Max Biped and Kimodo (SOMA). A-pose and centimetre
    rigs are handled;
  - import clips from the right-click menu: `.vrma`, or `.glb`/`.gltf`,
    `.fbx` and `.bvh` converted to `.vrma`;
  - clips blend with the procedural poses and with each other; the gaze
    toward the mouse stays on top;
  - real Kimodo BVH exports (SOMA skeleton) convert correctly: its thigh is
    called "Leg", and its zero pose is not a body, so the first frame is used
    as the reference;
  - clips can have phases: an entry ("sit down", then stay seated), a loop and
    an exit ("stand up"). Sitting on the floor lowers the camera so the legs
    stay in view.
- New gestures:
  - stretch, yawn, doze and dance: the AI can ask for them, and idle life
    uses the first three;
  - sitting on an edge.

  Each has a procedural pose until a real clip is imported.
- New movements with Kimodo, generated on your own GPU (optional, 3D avatars):
  - ask in chat for a movement the avatar does not know ("do a bow"): the
    model describes it in a new optional `motion` field, kimodo.cpp generates
    it in the background and the avatar plays it. About 15–30 s the first
    time, instant from the cache after that;
  - Kimodo starts on the first request and stops after five idle minutes, to
    free video memory;
  - off by default: right-click menu → "Movimenti nuovi con Kimodo". kimodo.cpp
    and its weights are installed separately (`docs/kimodo-locale.md`).
- Developer tools for Kimodo:
  - `npm run kimodo` generates clips as `.vrma`; with `--series` it generates
    the whole base set in `scripts/kimodo-series.json`. Entry, loop and exit
    of the same gesture come from one request, so they join up; loops are cut
    where they repeat best and closed so they do not jump;
  - `npm run preview` shows clips on a real avatar and saves screenshots;
  - measured on an RTX 3060: the 20 base clips in about 5 minutes.
- Clips that start seated (a sitting loop, standing up) were raised to
  standing height: the rest pose was taken from the first frame. The rest pose
  is now the standing T-pose on the real floor.

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

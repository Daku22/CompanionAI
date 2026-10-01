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
- Sitting on windows and the taskbar, as in Mate Engine (ideas only):
  - a shadow under the feet shows where the avatar will land. Drop it with
    the shadow on the top edge of a window: it stands there, then sits with
    its legs dangling, and follows the window when it moves or grows;
  - it gets down when the window is minimized, maximized, fullscreen or
    closed, and stays where you leave it when you pick it up;
  - on the bottom taskbar it sits when the shadow falls on the taskbar itself;
  - on a window it is no longer always on top: it stays just above that
    window, so the windows in front of it cover it. While that window is the
    active one the avatar goes back on top, or clicking the window hid the
    dangling legs behind its title bar;
  - other windows are read through the Windows API with Koffi (MIT); toggle
    in the right-click menu.
- Sitting poses had the thighs going backward and the knees bent the wrong
  way. Hands are relaxed instead of flat, in every pose.
- The 3D camera is a little wider (38°), so the shadow under the feet is not
  cut by the window's bottom edge.
- The window starts in the right place when the taskbar is on the top or left.
- Animations in one format, `.vrma`, on every humanoid model:
  - GLB/glTF and FBX avatars with a human skeleton are now animated like VRM
    ones. Bones are recognized from the names used by Mixamo, VRoid, Unreal,
    Blender Rigify, 3ds Max Biped and Kimodo (SOMA). A-pose and centimetre
    rigs are handled;
  - models from Sketchfab and similar sites: FBX textures are found in
    `textures/` folders, by file name or by material name, TGA included;
    glTF "specular-glossiness" materials are no longer black; bone names
    with a character prefix ("Shibahu_Head", "ValveBiped.Bip01_…") are
    recognized; display pedestals are removed. An FBX with a bone and a mesh
    of the same name (Pomni) no longer stops loading;
  - import clips from the right-click menu: `.vrma`, or `.glb`/`.gltf`,
    `.fbx` and `.bvh` converted to `.vrma`;
  - try any clip from the right-click menu (Animazioni → Prova): every
    file by gesture, with its phase and folder, plus the Kimodo movements in
    the cache, shown by the sentence they came from. Gestures without clips
    show their procedural pose;
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

- Live2D avatars (Cubism 3, 4 and 5): import the folder with the
  `.model3.json`; only the files it declares are copied. They play their own
  motions for the chat's gestures (matched by name, changeable in Settings →
  Live2D), turn the mood into an expression or a smile, blink, breathe, follow
  the mouse, move the mouth with the voice, dangle when carried, and the mouse
  only grabs them on their visible meshes.
- The Live2D Cubism Core is downloaded from Settings → Live2D once you accept
  its license: the official SDK zip at a fixed version and SHA-256, keeping
  only the Core. It is checked again every time it is served.
- PixiJS 7.4 → 8.22 for the 2D avatars.

### Camera and room
- 3D camera: drag with the right or middle button to turn around the avatar,
  hold Alt to move the camera instead, wheel to zoom. The right button opens
  the menu only when released without moving. Double-click the middle button,
  or "Rimetti la camera", to reset it. The head still follows the mouse from
  any angle.
- The room ("Stanza", right-click or tray menu): the avatar's window becomes
  a bigger, resizable window in the taskbar, with its own title bar
  (minimize, maximize, back to the desktop), borders to resize it, the chat
  docked on the right and a 3D scene behind the avatar. It remembers its size
  and position, and the app reopens in the mode it was closed in. In the room
  the left button turns the camera; 2D avatars are drawn over the scene.
- Scenes: "Studio" (backdrop and floor), "Giardino" (computed sky with the
  real sun, stars at night) and two photo scenes from Poly Haven HDRIs (CC0):
  "Collina" (dawn, noon, sunset, night) and "Stanza vuota" (day, night).
- Import your own 3D scenes (right-click → "Scena"): `.glb`/`.gltf`, `.fbx`
  and `.obj` with its `.mtl` and textures. Scale, floor and the avatar's spot
  (free floor, clear toward the camera) are estimated, and "Sistema la scena"
  (⚙ in the title bar) fixes them live: size, rotation, floor height, and
  "Metti l'avatar qui" to click the spot. The camera stays inside the walls.
  Imported scenes can be deleted.
- The light follows the local time (sun position from date, time and
  latitude) and, softly, the avatar's mood.
- Optional real weather (off by default): "Meteo vero nella stanza" and a city
  in the chat settings. Clouds, rain, snow and fog come from Open-Meteo, at
  most every 30 minutes and only while the room is open.

### Voice
- The companion can read its replies aloud (off by default), with the Kokoro-82M
  model and two Italian voices, Sara and Nicola, generated on your computer.
  Italian is spoken with Italian phonemes from eSpeak NG: the official
  JavaScript library for Kokoro turned Italian text into English sounds.
- A new Settings window ("Impostazioni", right-click or tray menu) with the
  voice section: on/off, voice, speed, volume, "Prova la voce" and "Basta", and
  the voice files, downloaded once (about 180 MB), checked with SHA-256, and
  removable.
- Replies are spoken sentence by sentence: the next one is prepared while the
  current one plays, and a new message stops the old reply.
- 3D VRM avatars move their mouth with the voice.
- XTTS-v2 (optional, NVIDIA graphics card): the companion speaks with a voice
  cloned from a sample you import, or with one of the model's 58 voices.
  "Installa XTTS" (after accepting the model's non-commercial license) sets up
  a private Python environment with pinned, hash-checked packages and the model;
  "Disinstalla" removes it. A local service streams each sentence while it is
  generated, so the first words come in about a second. Kokoro is the fallback.
- Microphone (optional, off by default, after XTTS): hold the global shortcut
  (Ctrl + Alt + M by default) or the 🎙 button in the chat, speak and
  release, and what you said is sent as a message. A short tap keeps the
  microphone open until the next tap; Esc cancels. Speech is transcribed on
  your graphics card by Whisper large-v3-turbo (faster-whisper) in the same
  local service as XTTS: "Installa il microfono" adds its pinned,
  hash-checked packages and the model (about 1.8 GB). The companion stops
  talking while you speak and shows "Ti ascolto…".
- Choose the microphone in the settings, from the input devices Windows
  lists. The choice is found again by name if its id changes (another USB
  port); if it is unplugged, Windows' default microphone is used and the app
  says so.
- The Settings window has two tabs, Voce and Microfono, and reopens on the
  last one used.
- A voice model that is no longer needed (XTTS after switching to Kokoro with
  the microphone on, or Whisper after turning the microphone off) frees its
  video memory after two minutes, about 2 GB each.

### Look and settings
- New look for the chat, the companion and Settings: a warm neutral palette
  with one green accent instead of purple, shared in `ui.css`, and the Geist
  font (SIL OFL 1.1) bundled with the app.
- Settings in one place, with four tabs: Modello (provider, model and key),
  Generale (start with Windows, idle life, weather), Voce and Microfono. ⚙ in
  the chat opens Modello; the panel above the chat is left only for the
  first start, until a key is saved. Chat and Settings stay in sync.
- An empty chat shows a short introduction and three suggestions.
- No more `confirm()` dialogs: a wrong-looking key, deleting the memory or
  uninstalling ask for a second click, with the warning next to the button.
- The room title bar is solid instead of blurred: a blur over the 3D scene
  had to be redone every frame and slowed the room down.

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
  again. The log mentions it once, not at every message.
- The setup screen shows when a key is already saved: the empty field looked
  as if the key had just been lost.
- Ollama gets two minutes to answer, since the first message loads the model
  (48 s for Mistral 7B on an RTX 3060). A slow Ollama is no longer reported
  as switched off.
- OpenRouter's daily limit on free models is recognized: the app stops
  retrying and trying other models, which only used up more requests, and
  says to try again tomorrow.
- An HTTP 403 no longer reads as a rejected key: the key is fine, the model is
  not allowed. Inkling, usable only from "agentic harnesses", left the
  fallback list.
- `npm run bench` measures how well each free OpenRouter model follows the
  reply format, a few calls a day, and resumes where it stopped.
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
- A plain-text `apiKey` left by an old config format is moved among the
  encrypted keys and removed from the file.
- Every IPC channel checks its sender. Browser permissions are denied, except
  the microphone (audio only, never the camera) for the app's own pages while
  the microphone is on in the settings.
- Content Security Policy without inline scripts or `eval`.
- Packaged with Electron 44 and Electron Fuses.

### Distribution
- Windows installer (NSIS), built and published by GitHub Actions with
  SHA-256 checksums.
- Optional start with Windows, and an error log file with no telemetry.
- Code under the MIT License. Asset licenses listed in `ASSETS-LICENSE.md`.

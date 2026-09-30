# CompanionAI

A desktop companion that lives on top of your windows. It walks across the
screen, chats with you through the AI provider you choose, can open files,
folders and websites for you (always asking first), and remembers your
conversations from one day to the next.

- **Avatars:** a 3D VRM avatar, or 2D animated sprites. You can import your own
  VRM, GLB/glTF or sprite packs.
- **Desktop or room:** it lives on your desktop, or in its own room, a bigger
  window with a 3D scene whose light follows the time of day (and, if you
  want, the real weather).
- **Seven AI providers behind one router:** OpenRouter (free models), Claude,
  ChatGPT, Grok, Gemini, Mistral and local Ollama.
- **Persistent local memory:** old conversations fade into a summary, and the
  originals are kept in a lossless archive on your disk.
- **Restricted system actions:** checked before you are asked to approve them.
- **Private by design:** no telemetry, no account, everything runs inside the app.

> Windows only. The user interface is currently in **Italian**. English UI is
> on the roadmap. [Leggi in italiano](README.it.md).

## Download

Get the installer from the [Releases](https://github.com/Daku22/CompanionAI/releases) page:
`CompanionAI-Setup-<version>.exe`. Its SHA-256 checksum is in `SHA256SUMS.txt`.

The installer is not code-signed yet, so Windows SmartScreen will warn that
the publisher is unknown. Click **More info → Run anyway**. You can build it
yourself from source if you prefer (see below).

## Getting started

1. Launch CompanionAI. The avatar appears near the bottom-right corner, and the
   chat opens on the setup screen.
2. Pick a provider. **OpenRouter** is the quickest start: create a free
   account, then a key. The "Come ottengo una chiave?" link opens the right
   page. **Ollama** needs no key at all, just `ollama serve` running.
3. Paste the key, choose a model, and start chatting. Double-click the avatar,
   or use the 💬 button that appears when the mouse is over it, to open and
   close the chat. The 🔄 button switches avatar.

**Using the mouse on the avatar:**
- Clicks on the empty parts of its window go through to whatever is below.
- Grab the avatar to carry it around: it sways as you move it, and in 3D its
  hair follows the motion.
- In 3D it turns its head toward the mouse; in 2D it faces the mouse's side.
- In 3D, drag with the right or middle button to turn the camera around it,
  hold Alt while dragging to move the camera instead, and use the wheel to
  zoom. Double-click the middle button (or "Rimetti la camera" in the menu)
  to reset the view.
- Drop it with the shadow under its feet on the top edge of a window: it
  stands there, then sits with its legs dangling and follows the window. It
  can sit on the bottom taskbar too.
- Right-click (without dragging) for a menu with the chat, "Stanza" (the
  room), avatars, animations (import them, or try any of them with "Prova"),
  size (small to extra large), "Segue il mouse" (follow the mouse), "Vita
  autonoma" (idle life), "Sempre in primo piano" (always on top), "Si siede su
  finestre e taskbar" (sit on windows and the taskbar), hide and quit.

**The room** ("Stanza" in the right-click or tray menu) turns the avatar's
window into a bigger, resizable window with its own title bar and the chat
docked on the right. Pick a scene from the title bar: "Studio", "Giardino" (a
computed sky with the real sun, and stars at night), or the photo scenes
"Collina" and "Stanza vuota". The light follows the local time and, softly,
the avatar's mood. In the room the left button turns the camera too.
You can also import your own 3D scenes: right-click → "Scena" → "Importa scena
3D" accepts `.glb`/`.gltf`, `.fbx` and `.obj` (with its `.mtl` and textures).
Scale and the avatar's spot are estimated; fix them with ⚙ in the title bar
("Sistema la scena": size, rotation, floor height, "Metti l'avatar qui").
Imported scenes can be deleted from the same menu or panel. Respect their
licenses: many free scenes (for example CC-BY ones from Sketchfab) ask for
credit if you share them.
Optional: "Meteo vero nella stanza" in the chat settings adds clouds, rain,
snow and fog from the real weather of a city you type (through Open-Meteo, see
[PRIVACY.md](PRIVACY.md)). The ✕ in the title bar brings the avatar back to
the desktop.

**Voice (optional, off by default).** Right-click → "Impostazioni… (voce)":
turn on "Legge ad alta voce le risposte", press "Scarica" once (about 180 MB:
the Kokoro-82M model with two Italian voices, Sara and Nicola, and the eSpeak NG
phonemizer), and the companion reads its replies aloud while its mouth follows
the voice. The voice is generated on your own computer, on the processor, about
2–3 times faster than real time; the first sentence starts in about a second
(a few more the first time, while the model loads). Speed and volume are in the
same page, with "Prova la voce" to hear them.

Ask things like "open my Documents folder", "search the news about AI" or just
chat. Anything that touches your system shows a confirmation dialog first.

## Avatars

| Avatar | Type | Notes |
|---|---|---|
| **Fred** | 3D, VRM 1.0 | Built in. By Swampazzo, redistributable ([details](ASSETS-LICENSE.md)) |
| Your own | VRM, GLB/glTF, FBX | Menu → "Importa avatar". VRM models are animated, and so are GLB/glTF and FBX models with a human skeleton (Mixamo, VRoid, Unreal, Blender Rigify, 3ds Max). Others are shown as a static preview |
| Your own | 2D sprite pack | A folder with `sprites.json` and one PNG per animation. Create one with `npm run strips` (see [docs/avatar-brief.md](docs/avatar-brief.md)) |

To remove imported avatars: Menu → "Elimina importati", tick the ones to delete
and confirm. Built-in avatars cannot be deleted.

**Animations.** Right-click the avatar → "Animazioni" → "Importa animazione" to
add a clip for a gesture (idle, greeting, sitting, being carried…). It accepts
`.vrma` and converts `.glb`/`.gltf`, `.fbx` and `.bvh` clips to `.vrma`, so the
same clip plays on every 3D avatar. Where there is no clip, the built-in
procedural poses are used.

**New movements with Kimodo (optional, 3D avatars).** Ask in chat for a
movement the avatar does not know ("do a bow", "hop on one foot") and it is
generated on your own graphics card with [Kimodo](docs/kimodo-locale.md)
(NVIDIA's text-to-motion model, run by kimodo.cpp), then played. It takes
about 15–30 seconds the first time, and is instant the next time the same
movement is asked for. Kimodo is installed separately (about 5.5 GB of
weights, a Vulkan graphics card with about 3 GB of free video memory) and
turned on from the right-click menu: "Movimenti nuovi con Kimodo". Nothing
leaves your PC: the model runs locally and stops after five idle minutes.

The companion has a mood that fades over time and colours its replies, and it
lives a little when you are not chatting: it looks around, takes a few steps,
dozes off when you are away. These gestures never call a model. Turn them off
with "Vita autonoma" in the settings.

An original built-in 2D character is in the works: a scruffy cat girl. Its
brief is in [docs/avatar-brief.md](docs/avatar-brief.md).

Imported avatars stay on your computer. Respect their licenses: many VRM
models declare their terms in their own metadata.

## Privacy

Conversations are sent **only** to the AI provider you pick. Memory, settings
and imported avatars stay on your disk, and API keys are encrypted with
Windows' own key store. There is no telemetry. Details in
[PRIVACY.md](PRIVACY.md).

## Safety

The AI can only propose a short list of actions: open an `http(s)` link, open
a file or folder (never an executable), open an item on your Desktop, or start
Notepad, Calculator, Paint or Explorer. Each proposal is validated, then shown
to you for approval. See [SECURITY.md](SECURITY.md) for the details and for
how to report a vulnerability.

## Build from source

You need Node.js 22 or newer, on Windows.

```bash
npm install
npm start
```

| Command | What it does |
|---|---|
| `npm start` | Run the app |
| `npm run dev` | Run with DevTools open |
| `npm run check` | Type check plus all test suites (no network, no windows) |
| `npm run smoke` | Launch the real app and check it from the inside: errors, CSP, every avatar |
| `npm run build` | Build the Windows installer |
| `npm run strips -- --masters <folder>` | Turn sprite master sheets into a 2D avatar |
| `npm run check:publish` | Verify that no private asset or secret would be published |
| `npm run bench -- --max 20` | Measure how well each free OpenRouter model follows the reply format, with your saved key; a few calls a day, resumable |

The code is plain JavaScript on Electron, type-checked by TypeScript through
JSDoc. The renderer uses PixiJS for 2D and three.js with `@pixiv/three-vrm`
for 3D. [CONTRIBUTING.md](CONTRIBUTING.md) explains the layout and the rules.

## License

The code is released under the [MIT License](LICENSE). The avatar assets have
their own licenses: see [ASSETS-LICENSE.md](ASSETS-LICENSE.md). Bundled
libraries are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

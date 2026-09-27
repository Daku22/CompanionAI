# CompanionAI

A desktop companion that lives on top of your windows. It walks across the
screen, chats with you through the AI provider you choose, can open files,
folders and websites for you (always asking first), and remembers your
conversations from one day to the next.

- **Avatars:** a 3D VRM avatar, or 2D animated sprites. You can import your own
  VRM, GLB/glTF or sprite packs.
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
3. Paste the key, choose a model, and start chatting. The 💬 button on the
   avatar opens and closes the chat. The 🔄 button switches avatar.

Ask things like "open my Documents folder", "search the news about AI" or just
chat. Anything that touches your system shows a confirmation dialog first.

## Avatars

| Avatar | Type | Notes |
|---|---|---|
| **Fred** | 3D, VRM 1.0 | Built in. By Swampazzo, redistributable ([details](ASSETS-LICENSE.md)) |
| Your own | VRM, GLB/glTF | Menu → "Importa avatar". VRM models are animated. GLB/glTF models are shown as a static preview |
| Your own | 2D sprite pack | A folder with `sprites.json` and one PNG per animation. Create one with `npm run strips` (see [docs/avatar-brief.md](docs/avatar-brief.md)) |

To remove imported avatars: Menu → "Elimina importati", tick the ones to delete
and confirm. Built-in avatars cannot be deleted.

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

The code is plain JavaScript on Electron, type-checked by TypeScript through
JSDoc. The renderer uses PixiJS for 2D and three.js with `@pixiv/three-vrm`
for 3D. [CONTRIBUTING.md](CONTRIBUTING.md) explains the layout and the rules.

## License

The code is released under the [MIT License](LICENSE). The avatar assets have
their own licenses: see [ASSETS-LICENSE.md](ASSETS-LICENSE.md). Bundled
libraries are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

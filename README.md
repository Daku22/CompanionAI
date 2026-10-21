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
- **Four AI providers behind one router:** OpenRouter (free and paid models),
  Claude, OpenAI and Ollama (local or cloud), with live model lists.
- **Senses and connectors:** it can look at your screen when you ask, know
  which app you are using (optional), and use MCP connectors like Claude's
  (web search, Notion, Todoist, GitHub, your own folders…).
- **Persistent local memory:** old conversations fade into a summary, and the
  originals are kept in a lossless archive on your disk.
- **Needs and play:** it gets hungry and thirsty, eats what you drag onto it,
  and plays with a ball, a yarn ball or a teddy bear on your desktop
  (volleyball included).
- **Voice and live:** replies appear as they are written and the voice starts
  at the first sentence, with captions in its speech bubble; a hands-free
  microphone; and a co-host for your Twitch live.
- **Game companion:** it watches the game you are playing and comments on it,
  calling the model only when the scene changes.
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
   page. **Claude** and **OpenAI** work with your own key. **Ollama** needs
   no key: if it is installed, the app starts it by itself, and you can
   download models or use Ollama's cloud models from the same page.
   "Prova il modello" checks that the chosen model answers properly.
3. Paste the key, choose a model, and start chatting. Double-click the avatar,
   or use the 💬 button that appears when the mouse is over it, to open and
   close the chat. The 🔄 button switches avatar.

**Using the mouse on the avatar:**
- Clicks on the empty parts of its window go through to whatever is below.
- Grab the avatar to carry it around: it sways as you move it, and in 3D its
  hair follows the motion. A click with a shaky hand stays a click; hold the
  button still for a moment to pick it up without moving it.
- In 3D it turns its head toward the mouse; in 2D it faces the mouse's side.
- It reacts to where you touch it: a tap on the face startles it, on the
  belly it giggles, on the legs it hops. Move the mouse back and forth over
  its head, without pressing, to pat it. Clicking its lower belly again and
  again embarrasses it, then it scolds you, then it turns its back for a few
  seconds. Touches nudge its mood, the model hears about the last one, and
  with the voice on it sometimes says a short line out loud.
  "Reagisce ai tocchi" in the settings turns this off.
- High five: keep the mouse still for a second beside one of its hands, or
  ask in chat ("batti cinque!"). It raises a hand toward you, and in 3D the
  hand follows the cursor a little; click it to slap it. When it is happy it
  sometimes offers one by itself.
- "Balla con la musica" in the settings (off by default): when a music app
  from your list plays (Spotify, a browser, VLC…), it listens to the beat on
  your computer and dances in time. Nothing is recorded or sent.
- In 3D, drag with the right or middle button to turn the camera around it,
  hold Alt while dragging to move the camera instead, and use the wheel to
  zoom. Double-click the middle button (or "Rimetti la camera" in the menu)
  to reset the view.
- Drop it with the shadow under its feet on the top edge of a window: it
  stands there, then sits with its legs dangling and follows the window. It
  can sit on the bottom taskbar too.
- Leave it more than halfway past the left or right edge of the screen and
  it stays there, peeking: only its head, a bit of shoulder and the hand
  holding the edge show, like someone peeking around a wall. It
  comes out when the mouse gets close, when a reply arrives, or with a
  double-click. Over a full-screen app it comes back inside instead.
- Right-click (without dragging) for a menu with the chat, "Stanza" (the
  room), avatars, animations (import them, or try any of them with "Prova"),
  size (small to extra large), "Chibi" (big head and small body, for 3D
  avatars with a human skeleton, saved per avatar; also in the settings), "Segue il mouse" (follow the mouse), "Vita
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
Optional: "Meteo vero nella stanza" in Settings → Generale adds clouds, rain,
snow and fog from the real weather of a city you type (through Open-Meteo, see
[PRIVACY.md](PRIVACY.md)). The ✕ in the title bar brings the avatar back to
the desktop.

**Settings.** Right-click the avatar (or the tray icon) → "Impostazioni…", ⚙
in the chat, or the gear on the bar around the companion. A sidebar in groups:
Generale (start with Windows, idle life, weather, the bar always visible),
Personaggi (personas and avatars as cards), Modello (provider, model and key),
Connettori, Voce, Microfono, Visione (the screen and the active app), Memoria
(memory and diary of each persona), Movimenti (the movements generated with
Kimodo: rename, try, delete), Live2D and Tasti rapidi.

**New look.** Hover a companion and a bar shows around it: on the left three
rings (mood, energy, bond), on the right its chat, the room, the avatar menu
and hide, below a pill with the microphone, pause (silences the voice and
stops its idle life), the group chat (with two or more companions), who is on
the desktop, settings and a grip to drag it. "Barra sempre visibile" in
Generale keeps it on. Each companion has its own chat window, and the group
chat is a window of its own; they open side by side. The chat shows the
companion's face, your messages in amber, the three rings at the bottom and
"Compatta" and "Dimentica tutto" in the "⋯" menu; a message that gets no reply
has a "Riprova" button.
- **Personaggi:** a card for each persona (face, bond level, "Sul desktop",
  "Attiva", and "Nuova persona"); a click opens its name, voice and
  personality. The Avatar tab shows every avatar with its type, "Usa" for the
  companion you pick, "Elimina" for imported ones and "Importa".
- **Face photos:** the first time a companion wears an avatar it takes a photo
  of its face (3D held still, looking ahead, eyes open; 2D from its idle
  frame; Live2D from the top). Until then the card shows the initials.
- **Tasti rapidi:** Ctrl + Alt + C opens and closes the chat, Ctrl + Alt + H
  shows and hides the companions, and the microphone shortcut lives here too.
  If another program already uses one, the page says so: pick another, or
  "Nessuna".

**Personas and your relationship.** In Settings → Personaggi each persona has a
name, a personality you write, a voice (with "Prova" to hear it), and its own
memory, mood, relationship and diary; it remembers the avatar it was using.
The memory you had before becomes the first persona. The relationship goes
from "Sconosciuto" to "Anima gemella": it grows with the days you talk and
with how you treat it, and drops after long absences or hostile tones. It
unlocks nothing; it changes the tone of the replies and how often the
affectionate or annoyed reactions come. Level and days together show next to
the mood in the chat.
- **Diary:** on the first start of a day, the persona writes a page about the
  last day you talked, about whatever it wants. Read it in "Memoria".
- **It writes first** ("Scrive per primo", on by default): a greeting the
  first time you meet in the day, a welcome back after a couple of hours
  away, a message after a long silence. At most 6 a day, never while it
  sleeps, while you type or over a full-screen app. Reading these aloud is a
  separate option, off by default.
- **Readable memory:** in "Memoria" (pick the persona there) you can correct the summary by hand and
  delete any remembered message. "Compatta" in the chat summarises everything
  but the last few messages.

**More companions (up to 3).** Turn on "Sul desktop" for a persona in
Settings → Personaggi, or use "Companion sul desktop" in the right-click or tray
menu. Each one has its own avatar, voice, memory, mood and idle life, and they
don't step on each other: a new one appears in a free spot, walking stops
before another, one dropped on top of another slides aside, and a seat on a
window or the taskbar belongs to one at a time. The app remembers who was on
the desktop and where.
- **Group chat:** with more than one on the desktop, chips under the chat
  header pick "Tutti" or a single companion. Call one by name and that one
  answers; otherwise one answers and sometimes a second reacts (at most two
  replies, each with its name and colour). Everyone hears the conversation
  and remembers it.
- **They look at each other and talk:** listeners look at whoever speaks, and
  now and then glance at a neighbour. A companion you add greets the others,
  and every so often one comments on another (what it is doing, what it said),
  who can answer once. These have their own budget (12 a day each), apart from
  the 6 messages a day each one writes to you.
- **The room fits everyone:** opening the room, the other 3D companions join
  the scene as guests, with their gestures, expressions, voice and touches.
  Live2D and 2D companions stay on the desktop.

**Hunger, thirst and toys.** The companion gets hungry and thirsty while the
app is open (full hunger in about 8 hours, thirst in about 5; time with the
app closed does not count). A little hungry, it sulks a bit, yawns, walks
slower and says so now and then; very hungry, it complains, answers curtly,
asks you for something specific and your bond drops slowly until it eats.
Nothing is permanent, and "Fame e sete" in Settings → Generale turns it all
off. Two rings in the bar and in the chat show how it is doing.
- **Food:** the "Cibo" button in the bar opens 21 foods and drinks. Drag one
  onto the companion: it eats or drinks it (in 3D, with the food in its hand)
  and thanks you. Offering it in chat works too ("ti preparo un tè").
- **Objects:** the bag button opens the objects: a beach ball, a yarn ball, a
  teddy bear and a cushion, and "Importa" for your own glTF/GLB, FBX or OBJ
  model. For an imported model you pick a name, a size and what it is for:
  "Da lanciare", "Da abbracciare", "Cibo", "Bevanda" or "Decorazione" (change
  it later with the pencil on its card).
- **On the desktop:** drag an object out of the panel and it stays on the
  desktop, falling and bouncing; grab it and throw it with the mouse;
  double-click (or right-click) puts it back in the bag. At most 5 at a time.
  - Throw the ball: the nearest companion runs after it, picks it up and
    brings it back to your mouse.
  - Leave the teddy or the cushion on a companion: it hugs it and dozes; a
    click on it, or 20 seconds, and it puts it down.
  - A decoration stays where you leave it.
- **Volleyball:** click the ball on the ground and it goes to the nearest
  companion, who runs under it and hits it back towards your mouse; click it
  while it is in the air to send it back. The count is on the ball; it ends
  when the ball touches the ground, and each persona keeps its record. With
  more companions they also pass it to each other.
- **Playing alone:** when nobody writes to it for a while and there is a ball
  on the desktop, it sometimes plays with it (kicks it around, or juggles it).
  In chat, "giochiamo a palla" starts a game and "prendi il gomitolo" sends
  it after the yarn.

**Voice (optional, off by default).** In Settings → Voce turn on "Legge ad alta voce le risposte", press "Scarica" once (about 180 MB:
the Kokoro-82M model with two Italian voices, Sara and Nicola, and the eSpeak NG
phonemizer), and the companion reads its replies aloud while its mouth follows
the voice. The voice is generated on your own computer, on the processor, about
2–3 times faster than real time; the first sentence starts in about a second
(a few more the first time, while the model loads). Speed and volume are in the
same page, with "Prova la voce" to hear them.

**Your own voice with XTTS-v2 (optional, NVIDIA graphics card).** In the same
page choose "XTTS-v2", accept the model's license (Coqui Public Model License:
non-commercial use only) and press "Installa XTTS": the app installs, in its own
folder, a private Python 3.10 with PyTorch and the XTTS-v2 model (about 7 GB,
every file pinned and checked). Then "Importa un campione…" takes 10–30 seconds
of a single voice, without music, and the companion speaks with that voice;
the 58 voices included in the model are in the same menu. While this voice is
in use a local service keeps the model on the graphics card (about 2 GB of
video memory) and streams each sentence as it is generated. If XTTS is not
installed or fails, Kokoro speaks instead. Use only voices you have the right
to clone.

**Talk to it with the microphone (optional, after XTTS).** In the settings'
"Microfono" tab press "Installa il microfono" (about 1.8 GB: the faster-whisper packages and
the Whisper large-v3-turbo model) and turn on "Parlo al companion con il
microfono". Then hold Ctrl + Alt + M (change it in "Tasti rapidi"), or the 🎙 button in the chat, speak,
and release: what you said is sent as a message. A short tap keeps the
microphone open until the next tap, and Esc cancels. Pick which microphone to
use in the same tab (Windows' default one unless you choose). The audio is
transcribed on your graphics card in the same local service as XTTS (about
2.5 GB of video memory while the microphone is on) and never leaves your
computer.

Replies appear in the chat as they are written, and with the voice on it
starts speaking at the first finished sentence. Write a new message while it
answers and the reply in progress stops. While it speaks, its speech bubble
shows the sentence it is saying; with the voice off and the chat closed, the
bubble shows the reply as it arrives.

**Hands-free.** The microphone button in the bar around the companion (or
Ctrl + Alt + J) keeps the microphone listening: speak whenever you like, and
your words are sent when you stop for a moment. While the companion speaks
it does not listen, so it never answers its own voice from the speakers;
click it to interrupt it. With "Uso le cuffie" on, you can interrupt it by
just talking. Settings → Microfono → "Mani libere" has the sensitivity.

**Co-host for your Twitch live.** In Settings → Streaming write your channel
and turn on "In diretta" (or give it a hotkey). The companions read your
chat without an account, read-only (they never write in it), and answer
whoever writes a companion's name or starts with the command (`!chiedi` by
default). They thank subscriptions, gifts and raids, and every few minutes
(1 to 15, or never) comment on something in the chat. With more companions
on the desktop they take turns, and sometimes a second one adds a line.
Answers come with the voice, the animation and captions in the speech
bubble; in OBS capture the screen and they show above your windows. Caps
per minute and per viewer keep it calm, bots, links and duplicates are
skipped, and a log shows what was answered and what was dropped, and why.
Viewers' messages are always treated as text to read, never as instructions,
and they never go into the persona's memory; when you end the live, each
companion that spoke writes a short paragraph about it in its diary.

**Game mode.** In Settings → Visione pick the game's window from the
thumbnails (or the whole screen) and a model that sees images (the chat's
one, or another: there are free ones on OpenRouter; "Prova" shows it a red
square to check). Then press the gamepad button in the bar around the
companion, or give it a hotkey in Tasti rapidi. Every 5 seconds the app takes
a tiny fingerprint of the window, without calling any model; the model looks
only when the scene really changes, at most every 30 seconds and 20 times an
hour (both adjustable in Settings → Visione). The bar shows how many looks it
made in the last hour and, on OpenRouter, roughly what they cost. The
companion comments out loud and in its speech bubble, not in the chat: as a
fan, a commentator or with a tip (never spoilers), as its personality
decides. Now and then another companion on the desktop chimes in; during a
live the comments are for the viewers too. It does not look while you talk
or type, pauses by itself when the game is closed or minimized or an app
from the ignore list is in front, and resumes when it comes back. For 2
minutes it knows the last scene, so you can ask "what do you think of this
boss?" in the chat or hands-free; guides and builds only if you ask. When
you stop, it keeps one line in its memory about what you played. Play in
borderless windowed mode: the companion stays on top, while exclusive
fullscreen cannot be captured (it pauses and tells you). Screenshots are
never saved.

**Senses.** The 👁 button in the chat (or "guarda il mio schermo") takes a
screenshot of the companion's monitor and shows it as a preview: it is sent
with your next message only, to a model that sees images, and never saved.
"Sa quale app stai usando" in Settings → Visione (off by default) lets it
know the title of the window you are using. In the room, 📷 opens the photo
mode: pick a pose and an expression, then "Scatta" saves a PNG.

**Connectors (MCP).** Settings → Connettori works like Claude's connectors.
"Sfoglia i connettori" lists the most used ones: some work at once with no
account (Exa web search, Hugging Face, Microsoft Learn, Context7, DeepWiki,
Cloudflare Docs), others sign in to your account in the browser with one
click (Notion, Todoist, Linear, Jira and Confluence, Airtable, monday.com,
Canva, Zapier, Sentry, Vercel, Netlify, Webflow, Wix), GitHub takes a
personal token. "Aggiungi connettore personalizzato" takes the name and URL
of any MCP server. "File di una cartella" lets it read (and, if you allow
it, change) the files of one folder; it needs Node.js. Under "Cosa può fare"
you choose which actions each connector may use. **Every use asks your
permission**, except read-only actions you chose to trust. Bigger models
handle connectors much better than small free ones.

Ask things like "open my Documents folder", "search the news about AI" or just
chat. Anything that touches your system shows a confirmation dialog first.

## Avatars

| Avatar | Type | Notes |
|---|---|---|
| **Feniel** | 3D, VRM | Built in, the default. By puwawa ([details](ASSETS-LICENSE.md)) |
| **Shibahu** | 3D, GLB/glTF | Built in. By 腱鞘炎の人, CC BY 4.0 ([details](ASSETS-LICENSE.md)) |
| **Hiyori** | Live2D | Built in. Live2D's sample model ([details](ASSETS-LICENSE.md)); shows once the Cubism Core is installed (see below) |
| Your own | VRM, GLB/glTF, FBX | Menu → "Importa avatar". VRM models are animated, and so are GLB/glTF and FBX models with a human skeleton (Mixamo, VRoid, Unreal, Blender Rigify, 3ds Max). Others are shown as a static preview |
| Your own | 2D sprite pack | A folder with `sprites.json` and one PNG per animation. Create one with `npm run strips` (see [docs/avatar-brief.md](docs/avatar-brief.md)) |
| Your own | Live2D (Cubism 3, 4, 5) | The folder with the `.model3.json` file. It plays the model's own motions, blinks, follows the mouse and moves its mouth with the voice. Needs the Live2D Cubism Core (see below) |

To remove imported avatars: Menu → "Elimina importati", tick the ones to delete
and confirm. Built-in avatars cannot be deleted.

**Live2D avatars.** Live2D models need the Cubism Core by Live2D Inc., which
cannot ship with the app. The installer offers it on its own page: tick the box
to accept its license and the setup downloads it from Live2D's website.
Otherwise, in Settings → Live2D accept its license (Live2D
Proprietary Software License) and press "Scarica il Cubism Core": the app
downloads the official Cubism SDK for Web 5-r.4 (about 19 MB) and keeps only
the Core (200 KB), checked with SHA-256. Chat gestures become the model's
motion groups, matched by their names ("Tap", "FlickUp"...), and the mood
becomes an expression; the same tab lets you change the matches for the
model on screen. Businesses with more than 10 million yen of yearly revenue
that publish an app with Live2D also need Live2D's Cubism SDK Release License.

**Animations.** Right-click the avatar → "Animazioni" → "Importa animazione" to
add a clip for a gesture (idle, greeting, sitting, being carried…). It accepts
`.vrma` and converts `.glb`/`.gltf`, `.fbx` and `.bvh` clips to `.vrma`, so the
same clip plays on every 3D avatar. The app ships 32 clips made with NVIDIA
Kimodo (see [ASSETS-LICENSE.md](ASSETS-LICENSE.md)); where a gesture has no
clip, procedural poses are used.

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
Notepad, Calculator, Paint or Explorer, take a screenshot you then confirm,
or use an action of a connector you added and allowed. Each proposal is
validated, then shown to you for approval. See [SECURITY.md](SECURITY.md) for the details and for
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

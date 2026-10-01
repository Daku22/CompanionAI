# Privacy

CompanionAI has no server, no account and no telemetry. This page lists
everything the app sends out and everything it stores.

## What leaves your computer

| Destination | When | What |
|---|---|---|
| The AI provider you chose | Every message you send, and when memory is summarized | Your message, the recent conversation, the memory summary and the app's instructions for the model. Your API key authenticates the request |
| `openrouter.ai` | When you open the settings with OpenRouter selected | A request for the list of free models. No key, no conversation |
| The Ollama server | Only if you use Ollama | Same as any AI provider. By default Ollama runs on your own computer (`127.0.0.1`) |
| A website | Only if the AI proposes opening a link **and you approve it** | The link opens in your default browser |
| `open-meteo.com` | Only if you turn on "Meteo vero nella stanza" (off by default), while the room is open, at most every 30 minutes | The city you typed (to the geocoding service), then its coordinates (to the weather service). No key, no account |
| `huggingface.co` and `cdn.jsdelivr.net` | Only when you press "Scarica" in the voice settings | Plain downloads of the voice files (about 180 MB). Nothing about you or your conversations |
| `github.com`, Python's download mirror used by uv, `pypi.org`, `files.pythonhosted.org`, `download.pytorch.org`, `huggingface.co` | Only when you press "Installa XTTS" | Plain downloads of uv, Python, the Python packages and the XTTS-v2 model (about 5 GB). Nothing about you or your conversations |
| `cubism.live2d.com` | Only when you press "Scarica il Cubism Core" in Settings → Live2D | A plain download of the official Cubism SDK for Web zip (about 19 MB), from which the app keeps only the Cubism Core. Nothing about you or your conversations |
| `pypi.org`, `files.pythonhosted.org`, `huggingface.co` | Only when you press "Installa il microfono" | Plain downloads of the faster-whisper packages and the Whisper model (about 1.8 GB). Nothing about you or your conversations |

The voice (Kokoro or XTTS, off by default) is generated on your computer: the
replies it reads aloud, and the sample of your voice, are never sent anywhere.
The microphone (off by default) is opened only while you hold the shortcut or
the 🎙 button, or after a tap until the next one. The recording is transcribed
on your computer and then discarded: it is never saved or sent anywhere. Only
the text it becomes is sent, as a message, to the AI provider you chose, like
a message you type. The log records how long a recording was, never what you
said. The voice service listens only on `127.0.0.1` and answers only to the
app (a random token, new at every start).

Movements generated with Kimodo ("Movimenti nuovi con Kimodo", off by
default) never leave your computer: the model runs on your own graphics card,
and it receives only the short English description of the movement.

What each provider does with your conversations is governed by that
provider's own privacy policy and terms. Pick one you trust. With Ollama,
nothing leaves your machine.

Requests to OpenRouter include the headers `X-Title: CompanionAI` and a
`HTTP-Referer`, which OpenRouter uses to show app statistics. They contain no
personal data.

## What stays on your computer

| Data | Where |
|---|---|
| Settings and API keys | `%USERPROFILE%\.desktop-companion\config.json`. Keys are encrypted with Windows' own key store (Electron `safeStorage`) |
| Conversation memory | `%USERPROFILE%\.desktop-companion\memory\`: recent turns, summary, and the lossless archive of summarized turns |
| Imported avatars | `%APPDATA%\CompanionAI\avatars\` |
| Imported animations | `%APPDATA%\CompanionAI\animations\` |
| Movements generated with Kimodo | `%APPDATA%\CompanionAI\generated-motions\`: the last 100, as `.vrma` files, and the sentence each one came from in `index.json` |
| Voice files | `%APPDATA%\CompanionAI\voice\`: Kokoro's model and phonemizer, XTTS (`xtts\`: Python, packages and model) and the microphone's Whisper model (`xtts\whisper\`). "Elimina i file" and the two "Disinstalla" buttons in the voice settings remove them |
| Your voice sample | `%APPDATA%\CompanionAI\voice\samples\`: the sample you imported, converted to WAV (at most 30 seconds), and its voice features (`.latents.pt`). Importing a new one replaces it |
| Live2D Cubism Core | `%APPDATA%\CompanionAI\live2d\`: the Core and its license. "Disinstalla" in Settings → Live2D removes them |
| Imported 3D scenes | `%APPDATA%\CompanionAI\scenes\` |
| Error log | `%APPDATA%\CompanionAI\logs\`: warnings and errors only, never your conversations. Open it from the tray icon menu |

**Deleting your data:**
- the chat's "Dimentica tutto" button erases the memory (summary, recent turns
  and archive);
- uninstalling the app keeps settings, memory and avatars, so a reinstall picks
  up where you left off. To remove everything, delete the folders above.

## Keys in environment variables

If no key is saved for the active provider, the app uses the matching
environment variable (for example `OPENROUTER_API_KEY`), if one is set. When
running from source, it also reads a `.env` file next to the code (see
`.env.example`). The installed app never reads `.env` files.

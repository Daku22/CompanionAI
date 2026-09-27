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
| Movements generated with Kimodo | `%APPDATA%\CompanionAI\generated-motions\`: the last 100, as `.vrma` files |
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

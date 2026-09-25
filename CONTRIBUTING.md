# Contributing

Thanks for wanting to help. CompanionAI is a small project, so these few rules
keep it healthy.

## Before you start

- For anything bigger than a small fix, **open an issue first** to discuss it.
- Security problems go through private reporting, not issues: see
  [SECURITY.md](SECURITY.md).
- The code comments and the UI are in Italian. Comments in English are welcome
  in new code. Keep the UI strings in Italian until the translation work lands.

## Setup

Windows, Node.js 22 or newer:

```bash
npm install
npm run check    # type check + all tests
npm start        # run the app
npm run smoke    # launch the real app and check it from the inside
```

## Layout

- `src/main/`: Electron main process. Windows, IPC, AI router, OS actions
  and their rules (`guards.js`), avatar library.
- `src/memory/`: persistent memory.
- `src/renderer/`: the two pages (companion and chat), with their scripts.
- `scripts/`: build tools, test suites, smoke test, publish check.

[README.it.md](README.it.md) describes the architecture in detail.

## Rules

1. **Every fix comes with a test that fails without it.** The test suites run
   without network or windows. If the change is visual, run `npm run smoke`
   and look at the screenshots.
2. **`npm run check` must pass**, and so must CI.
3. **No new runtime dependency** without discussing it first. The renderer
   libraries are vendored by `scripts/vendor.js`.
4. **The renderer never gets Node access**, and every new IPC channel is
   registered through `handle()`/`on()` in `main.js`, which check the sender.
   Anything the AI can trigger on the system goes through `guards.js`, and is
   validated before the confirmation dialog.
5. **No inline scripts or `eval`** in the pages: the Content Security Policy
   blocks them, and `npm test` checks it.
6. **Assets need a license that allows redistribution.** Add them to
   [ASSETS-LICENSE.md](ASSETS-LICENSE.md). `npm run check:publish` refuses the
   known non-redistributable ones.

## Pull requests

Keep them focused. Explain *why* in the description, not only what. If the PR
changes behavior users can see, add a line to [CHANGELOG.md](CHANGELOG.md).

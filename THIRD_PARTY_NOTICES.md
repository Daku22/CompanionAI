# Third-party notices

CompanionAI bundles the following libraries in its renderer. They are copied
into `src/renderer/vendor/` by `scripts/vendor.js` at build time. All of them
are released under the MIT License, whose full text is in each package's
`LICENSE` file.

| Library | Version | License | Copyright |
|---|---|---|---|
| [PixiJS](https://pixijs.com/) (`pixi.js`) | 7.4.3 | MIT | © 2013-2023 Mathew Groves, Chad Engler |
| [@pixi/unsafe-eval](https://github.com/pixijs/pixijs) | 7.4.3 | MIT | © 2013-2023 Mathew Groves, Chad Engler |
| [three.js](https://threejs.org/) (`three`, including `GLTFLoader`, `FBXLoader`, `BVHLoader`, `BufferGeometryUtils`, NURBS curves and the bundled `fflate`) | 0.177.0 | MIT | © 2010-2025 three.js authors (fflate © 2020 Arjun Barrett, MIT) |
| [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) | 3.5.5 | MIT | © 2019-2026 pixiv Inc. |
| [@pixiv/three-vrm-animation](https://github.com/pixiv/three-vrm) | 3.5.5 | MIT | © 2019-2026 pixiv Inc. |

The desktop runtime is [Electron](https://www.electronjs.org/) (MIT, © Electron
contributors, © GitHub Inc.). The installer includes Electron's
`LICENSE.electron.txt` and Chromium's `LICENSES.chromium.html`, which list the
licenses of Chromium and its dependencies.

Parts of the design were inspired by other open-source projects. No code was
copied from them:

- companion-emergence (MIT): the "fading memory" model,
  where old turns fade into a summary and the originals stay in a lossless archive.
- AIRI, Open-LLM-VTuber, Mate Engine and Shimeji-ee: how a desktop avatar
  should behave.

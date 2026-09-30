# Third-party notices

CompanionAI bundles the following libraries in its renderer. They are copied
into `src/renderer/vendor/` by `scripts/vendor.js` at build time. All of them
are released under the MIT License, whose full text is in each package's
`LICENSE` file.

| Library | Version | License | Copyright |
|---|---|---|---|
| [PixiJS](https://pixijs.com/) (`pixi.js`) | 7.4.3 | MIT | © 2013-2023 Mathew Groves, Chad Engler |
| [@pixi/unsafe-eval](https://github.com/pixijs/pixijs) | 7.4.3 | MIT | © 2013-2023 Mathew Groves, Chad Engler |
| [three.js](https://threejs.org/) (`three`, including `GLTFLoader`, `FBXLoader`, `BVHLoader`, `OBJLoader`, `MTLLoader`, `RGBELoader`, `RoomEnvironment`, `BufferGeometryUtils`, NURBS curves, `OrbitControls`, `Sky`, `GroundedSkybox` and the bundled `fflate`) | 0.177.0 | MIT | © 2010-2025 three.js authors (fflate © 2020 Arjun Barrett, MIT) |
| [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) | 3.5.5 | MIT | © 2019-2026 pixiv Inc. |
| [@pixiv/three-vrm-animation](https://github.com/pixiv/three-vrm) | 3.5.5 | MIT | © 2019-2026 pixiv Inc. |

The main process uses two libraries, installed as regular dependencies and
packed by electron-builder:

| Library | Version | License | Copyright |
|---|---|---|---|
| [Koffi](https://koffi.dev/) (`koffi`, with its Windows binary `@koromix/koffi-win32-x64`) | 3.3.2 | MIT | © 2026 Niels Martignène |
| [ONNX Runtime](https://onnxruntime.ai/) (`onnxruntime-node`, Windows x64 binaries only, with `onnxruntime-common`; the Windows build includes Microsoft DirectML) | 1.30.0 | MIT | © Microsoft Corporation |

Koffi calls the Windows API (user32, dwmapi) to read the other windows' size
and position, so the avatar can sit on them. ONNX Runtime runs the local
voice model (Kokoro) in a separate process.

Downloaded on first use, only if you turn on the voice in the settings. They
are not part of the app or of this repository; each file is checked against a
SHA-256 hash before use:

| Component | Version | License | Source |
|---|---|---|---|
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (ONNX export `onnx-community/Kokoro-82M-v1.0-ONNX`, fp16 model, voices `if_sara` and `im_nicola`) | 1.0 | Apache-2.0 | Hugging Face, fixed commit |
| [eSpeak NG](https://github.com/espeak-ng/espeak-ng), Emscripten build `@echogarden/espeak-ng-emscripten` | 0.3.5 | GPL-3.0 | jsDelivr (npm). Its license text is downloaded with it (`COPYING`). It turns Italian text into phonemes and runs only in the voice process |
| [XTTS-v2](https://huggingface.co/coqui/XTTS-v2) model (Coqui) | commit `6c2b0d7` | [Coqui Public Model License](https://huggingface.co/coqui/XTTS-v2/blob/main/LICENSE.txt): **non-commercial use only** | Hugging Face, fixed commit. Downloaded only after you accept the license in the settings; the license text is downloaded with it (`LICENSE.txt`) |
| [uv](https://github.com/astral-sh/uv) (Astral) | 0.12.21 | MIT or Apache-2.0 | GitHub releases. Installs the Python environment for XTTS |
| Python 3.10 (python-build-standalone) and the packages in `src/main/xtts/requirements.txt`, including [coqui-tts](https://github.com/idiap/coqui-ai-TTS) (MPL-2.0) and [PyTorch](https://pytorch.org/) with CUDA (BSD-3-Clause, with NVIDIA's CUDA libraries under their own licenses) | pinned, with hashes | each package's own license | Python's official downloads through uv, PyPI and download.pytorch.org |
| [Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) (OpenAI), CTranslate2 conversion `dropbox-dash/faster-whisper-large-v3-turbo` | commit `0a363e9` | MIT | Hugging Face, fixed commit. Downloaded only when you press "Installa il microfono" |
| The packages in `src/main/xtts/requirements-stt.txt`: [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT, includes the Silero VAD model, MIT), [CTranslate2](https://github.com/OpenNMT/CTranslate2) (MIT), [PyAV](https://github.com/PyAV-Org/PyAV) (BSD-3-Clause, with FFmpeg under LGPL), [ONNX Runtime](https://onnxruntime.ai/) (MIT) and their small helpers | pinned, with hashes | each package's own license | PyPI, through uv, into the XTTS environment |

`src/main/xtts/xtts_service.py` is part of CompanionAI (MIT): it only calls
coqui-tts and faster-whisper, which are installed separately in that Python
environment.

Data copied into the source:

- `src/renderer/kimodo-raw.js` contains the names, parents and rest offsets
  of the 30-joint SOMA skeleton. They come from
  [kimodo.cpp](https://github.com/localai-org/kimodo.cpp) `src/skeleton.hpp`
  (Apache-2.0), which took them from NVIDIA Kimodo
  `kimodo/skeleton/definitions.py` (Apache-2.0).

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

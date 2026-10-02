// companion-2d.js — avatar 2D su PixiJS: strip animate, stati, camminata, fumo.
// Quale avatar mostrare lo decide companion-3d.js, che chiama load2DAvatar().

const api = window.companion;
const bubbleEl = document.getElementById('bubble');
let bubbleTimer = null;

// Fumetti dell'avatar 2D. I testi di un personaggio ("Nya!") stanno nel suo
// pacchetto (sprites.json, campo "bubbles"): prima erano scritti qui e li
// diceva qualunque avatar 2D, anche un'immagine importata.
const DEFAULT_BUBBLES = {
  hello: '👋', wave: '👋', think: '…', sit: '💤', smoke: '🚬 ...',
  happy: '✨', grab: '!?', drop: '…',
};
let bubbles = { ...DEFAULT_BUBBLES };

function packBubbles(manifest) {
  const out = { ...DEFAULT_BUBBLES };
  const custom = manifest && manifest.bubbles;
  if (custom && typeof custom === 'object') {
    for (const key of Object.keys(DEFAULT_BUBBLES)) {
      if (typeof custom[key] === 'string') out[key] = custom[key].slice(0, 40);
    }
  }
  return out;
}

function showBubble(text, ms = 2800) {
  bubbleEl.textContent = text;
  bubbleEl.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), ms);
}

// ── Pixi Application ────────────────────────────────────────────────────────
// Pixi 8: l'applicazione si crea e poi si avvia con init(), che e' asincrono.
// Il ticker esiste solo dopo: chi lo usa aspetta appReady. WebGL, non
// WebGPU: il rendering di Live2D (blocco 4) e' scritto per WebGL.
window.app = new PIXI.Application();
// Nitidezza in enlarge: filtro lineare (mipmap per-strip al load).
PIXI.TextureSource.defaultOptions.scaleMode = 'linear';
let active2D = true;   // companion-3d.js lo spegne quando mostra un modello 3D
const appReady = app.init({
  resizeTo: window,
  backgroundAlpha: 0,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  preference: 'webgl',
}).then(() => {
  // 30 fps bastano: le strip vanno da 3 a 13 fotogrammi al secondo e il resto
  // (respiro, sobbalzo) e' lento. A 60 il companion consumava il doppio stando fermo.
  app.ticker.maxFPS = 30;
  document.getElementById('pixi-mount').appendChild(app.canvas);
  app.ticker.add(tick2D);
  if (!active2D) app.ticker.stop();
});
window.set2DActive = (on) => {
  active2D = !!on;
  if (!app.ticker) return;   // non ancora avviata: lo applica init
  if (active2D) app.ticker.start(); else app.ticker.stop();
};

// ── Containers ─────────────────────────────────────────────────────────────
const rootC   = new PIXI.Container();
const shadowG = new PIXI.Graphics();
const charC   = new PIXI.Container();
const smokeC  = new PIXI.Container();   // particles go here
const overlayG = new PIXI.Graphics();

app.stage.addChild(rootC);
rootC.addChild(shadowG);
rootC.addChild(smokeC);
rootC.addChild(charC);
rootC.addChild(overlayG);

// Container default position at ground baseline
// Centro della scena: nella stanza, con la chat agganciata a destra,
// __roomInset (companion-3d.js) e' lo spazio che la chat occupa.
const stageCenterX = () => (window.innerWidth - (window.__roomInset || 0)) / 2;
charC.x = stageCenterX();
charC.y = window.innerHeight - 12;

// Ground shadow: e' anche l'ancora per sedersi sulle finestre, quindi scura
// abbastanza da vedersi (l'alpha a ogni frame la decide il ticker).
shadowG.ellipse(0, 0, 28, 6).fill({ color: 0x000000, alpha: 1 });
shadowG.x = stageCenterX();
shadowG.y = window.innerHeight - 12;

// ── Strip ───────────────────────────────────────────────────────────────────
// Un avatar 2D e' un pacchetto di sprite (formato companion-sprites/1): per
// ogni animazione un PNG e i riquadri [x, y, w, h] dei fotogrammi. Li genera
// scripts/build-strips.js: fotogrammi ritagliati e alti al massimo 480 px.
// L'avatar integrato arriva da assets/strips/sprites.js, quelli importati da
// avatar://. Un'immagine singola importata e' un pacchetto con la sola idle e
// nessun riquadro: si usa l'immagine intera.
let STRIPS = {};           // anim -> { file, fps, frames }
let stripTextures = {};    // anim -> PIXI.ImageSource (l'immagine della strip)
let textureCache = {};     // key -> PIXI.Texture (un fotogramma)

function loadOneStrip(meta, baseUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // Mipmap: nitidezza quando la finestra rimpicciolisce il personaggio.
        resolve(new PIXI.ImageSource({ resource: img, autoGenerateMipmaps: true }));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('immagine ' + meta.file + ' non trovata'));
    // Le immagini di avatar:// sono di un'altra origine rispetto alla pagina:
    // senza la richiesta CORS WebGL non le accetta come texture. Le integrate
    // (percorso relativo, file://) no: su file:// CORS fallirebbe.
    if (/^[a-z]+:\/\//i.test(baseUrl)) img.crossOrigin = 'anonymous';
    img.src = baseUrl + meta.file;
  });
}

function getFrameTexture(anim, i) {
  const key = anim + '_' + i;
  if (textureCache[key]) return textureCache[key];
  const meta = STRIPS[anim];
  const base = stripTextures[anim];
  if (!meta || !base) return null;
  const f = meta.frames && meta.frames[i % meta.frames.length];
  const tex = new PIXI.Texture({ source: base, frame: f ? new PIXI.Rectangle(f[0], f[1], f[2], f[3]) : undefined });
  textureCache[key] = tex;
  return tex;
}

// ── AnimatedSprite helper ───────────────────────────────────────────────────
function buildAnimation(anim, speed) {
  const meta = STRIPS[anim];
  const textures = [];
  const count = meta.frames ? meta.frames.length : 1;
  for (let i = 0; i < count; i++) {
    const t = getFrameTexture(anim, i);
    if (t) textures.push(t);
  }
  if (!textures.length) throw new Error('nessun frame per ' + anim);
  const sprite = new PIXI.AnimatedSprite(textures);
  sprite.animationSpeed = speed;
  sprite.anchor.set(0.5, 1.0);   // pivot at feet-centre (bbox rifilate = piedi stabili)
  sprite.loop = true;
  return sprite;
}

// ── Smoke Particle System ───────────────────────────────────────────────────
const particles = [];

function spawnSmoke(wx, wy) {
  particles.push({
    x: wx + (Math.random() - 0.5) * 5,
    y: wy,
    vx: (Math.random() - 0.5) * 0.6,
    vy: -(0.7 + Math.random() * 0.6),
    r: 3 + Math.random() * 3,
    a: 0.6,
    life: 0,
    maxLife: 55 + Math.random() * 30,
  });
}

// Tutto e' scalato per delta (1 = un frame a 60 fps): con il ticker a 30 fps
// il fumo sale alla stessa velocita' di prima invece che a meta'.
function tickSmoke(delta = 1) {
  overlayG.clear();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += delta;
    p.x  += (p.vx + Math.sin(p.life * 0.09) * 0.35) * delta;
    p.y  += p.vy * delta;
    p.r  += 0.15 * delta;
    p.a   = (1 - p.life / p.maxLife) * 0.55;
    if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
    overlayG.circle(p.x, p.y, p.r).fill({ color: 0xd4dbd6, alpha: p.a });
  }
}

// ── State Machine ───────────────────────────────────────────────────────────
const State = {
  name:      'idle',
  posX:      90,
  dir:       1,       // 1 = right, -1 = left (lo decide il main durante la camminata)
  dragging:  false,
  perched:   false,   // seduto su una finestra o sulla taskbar (perch.js nel main)
  smokeTick: 0,
};

let animations = {};   // filled after load
let currentAnim = null;
let charSprite  = null;

let baseScale   = 1;     // ricalcolata a ogni frame da updateScale()

function setAnim(name) {
  // Seduto su una finestra, il riposo e' la seduta: ogni gesto torna li'.
  if (name === 'idle' && State.perched && animations.sit) name = 'sit';
  // Un pacchetto puo' non avere tutte le animazioni: quelle assenti diventano idle.
  if (!animations[name]) name = 'idle';
  if (!animations[name]) return;
  if (charSprite) charC.removeChild(charSprite);

  charSprite = animations[name];
  charSprite.play();
  charC.addChild(charSprite);
  State.name = name;
}

function updateScale() {
  if (!charSprite) return;
  // Scala sul frame corrente (non sul primo): i frame hanno altezze diverse
  // (es. sit 377-557) e così l'altezza a schermo resta costante, senza salti.
  const cur = charSprite.textures[charSprite.currentFrame] || charSprite.textures[0];
  const sh = cur?.height || 400;
  // Nella stanza la finestra e' grande: l'avatar non deve riempirla tutta.
  const share = document.body.classList.contains('mode-room') ? 0.6 : 0.78;
  const targetH = Math.min(window.innerHeight * share, window.innerWidth * 1.15);
  baseScale = targetH / sh;
}

// ── Main Ticker ─────────────────────────────────────────────────────────────
let t = 0;

// Pixi 8 passa il ticker, non il delta: deltaTime e' 1 per un frame a 60 fps.
function tick2D(ticker) {
  const delta = ticker.deltaTime;
  t += delta * 0.045;

  if (!charSprite) return;

  updateScale();
  reportSeat2D();
  // L'ombra segue il fondo della finestra anche quando cambia dimensione.
  shadowG.y = window.innerHeight - 12;

  const groundY = window.innerHeight - 8;
  const centerX = stageCenterX();

  if (!State.dragging && State.name !== 'walk' && State.name !== 'run') {
    State.posX = centerX;
  }

  charC.x = State.posX;
  // Anche charC.y: a terra, piu' il movimento di una reazione ai tocchi.
  applyTouchFx(groundY);

  const bob    = Math.sin(t * 3.2) * 1.8;
  const breath = 1 + Math.sin(t * 2.0) * 0.014;

  // I gesti a riposo (fumare, guardarsi attorno, sonnecchiare) li decide il
  // main in idle-life.js, uguali per il 2D e il 3D: qui c'era un "fuma" a
  // tempo fisso, contato in frame e quindi il doppio piu' lento a 30 fps.

  // ── DRAG STATE ────────────────────────────────────────────────────────
  // Penzola appeso per la testa: la rotazione ha il perno in alto, e la molla
  // di sway.js la spinge con la velocita' della finestra. Prima era un
  // pendolo a tempo, uguale da fermo e con uno strattone.
  if (State.dragging) {
    const { side } = sway.update(app.ticker.deltaMS / 1000, dragVel.vx, dragVel.vy);
    const cur = charSprite.textures[charSprite.currentFrame] || charSprite.textures[0];
    const H = (cur ? cur.height : 400) * baseScale * 1.05;
    const theta = side + Math.sin(t * 5) * 0.03;
    charSprite.rotation = theta;
    charSprite.x = -H * Math.sin(theta);
    charSprite.y = -H + H * Math.cos(theta) - 22 + Math.sin(t * 5) * 2;
    charSprite.scale.set(baseScale * State.dir * 1.05, baseScale * 1.05);

    // In braccio l'ombra resta a terra e si vede bene: e' il mirino per
    // posarlo sul bordo di una finestra (perch.js nel main).
    shadowG.alpha = 0.5;
    shadowG.scale.set(1.1);
    shadowG.x = State.posX;
    tickSmoke(delta);
    return;
  }

  // ── WALK ──────────────────────────────────────────────────────────────
  // Lo spostamento lo fa il main muovendo la finestra: qui lo sprite resta
  // centrato e ripete il ciclo di passo finche' il main non manda idle, a meta'
  // raggiunta. Prima la meta' coincideva con la posizione e il passo si
  // fermava al primo frame, mentre la finestra continuava a scorrere.
  if (State.name === 'walk' || State.name === 'run') {
    State.posX = centerX;

    const walkBob = Math.abs(Math.sin(t * 8)) * 3;
    charSprite.x = 0;
    charSprite.y = -walkBob;
    charSprite.rotation = Math.sin(t * 6) * 0.04;
    charSprite.scale.set(baseScale * State.dir, baseScale);

    shadowG.alpha = 0.35;
    shadowG.scale.set(1);
    shadowG.x = State.posX;
    charC.x = State.posX;
    overlayG.clear();
    return;
  }

  // ── SMOKE ─────────────────────────────────────────────────────────────
  if (State.name === 'smoke') {
    charSprite.x = 0;
    charSprite.y = bob;
    charSprite.rotation = 0.025;
    charSprite.scale.set(baseScale * State.dir * breath, baseScale * breath);

    if (Math.random() < 0.3 * delta) spawnSmoke(State.posX + 22 * State.dir, 140 + bob);
    tickSmoke(delta);

    shadowG.alpha = 0.35;
    shadowG.scale.set(1);
    shadowG.x = State.posX;
    charC.x   = State.posX;
    return;
  }

  // ── WAVE / THINK ──────────────────────────────────────────────────────
  if (State.name === 'wave' || State.name === 'think') {
    const wag = State.name === 'wave' ? Math.sin(t * 10) * 0.06 : Math.sin(t * 2.5) * 0.02;
    charSprite.x = 0;
    charSprite.y = bob;
    charSprite.rotation = wag;
    charSprite.scale.set(baseScale * State.dir * breath, baseScale * breath);

    shadowG.alpha = 0.35; shadowG.scale.set(1); shadowG.x = State.posX;
    charC.x = State.posX;
    overlayG.clear();
    return;
  }

  // ── SIT ───────────────────────────────────────────────────────────────
  if (State.name === 'sit') {
    charSprite.x = 0;
    charSprite.y = 12;    // sitting lower
    charSprite.rotation = 0;
    charSprite.scale.set(baseScale * State.dir, baseScale);

    shadowG.alpha = 0.3; shadowG.scale.set(0.85); shadowG.x = State.posX;
    charC.x = State.posX;
    overlayG.clear();
    return;
  }

  // ── DEFAULT IDLE ──────────────────────────────────────────────────────
  faceCursor(app.ticker.deltaMS);
  charSprite.x = 0;
  charSprite.y = bob;
  charSprite.rotation = Math.sin(t * 1.6) * 0.02;
  charSprite.scale.set(baseScale * State.dir * breath, baseScale * breath);

  shadowG.alpha = 0.35; shadowG.scale.set(1); shadowG.x = State.posX;
  charC.x = State.posX;
  overlayG.clear();
}

// ── Seduta su finestre e taskbar ────────────────────────────────────────────
// L'ancora per il main e' l'ombra ai piedi, al centro. La seduta 2D poggia
// dove poggiavano i piedi, quindi ombra e seduta coincidono. Si manda quando
// cambia, e ogni 2 s perche' passando dal 3D al 2D il main tenga quella giusta.
let seat2DSentAt = 0;
let seat2DKey = '';
function reportSeat2D() {
  if (window.__threeVisible || State.dragging || !api || !api.setSeatAnchor) return;
  const x = Math.round(window.innerWidth / 2);
  const y = Math.round(window.innerHeight - 12);
  const key = x + ',' + y;
  const now = performance.now();
  if (key === seat2DKey && now - seat2DSentAt < 2000) return;
  seat2DKey = key;
  seat2DSentAt = now;
  api.setSeatAnchor({ x, feet: y, seat: y });
}

// Posato su una finestra: prima in piedi sul bordo (phase 'stand'), poi seduto.
if (api && api.onPerchState) {
  api.onPerchState((data) => {
    State.perched = !!(data && data.perched && data.phase === 'sit');
    if (!window.__threeVisible && !State.dragging) setAnim('idle');
  });
}

// ── Drag & Drop ─────────────────────────────────────────────────────────────
// La finestra la muove il main (companion-input.js chiede drag:start): qui si
// riceve solo lo stato e la velocita'.
const sway = window.CompanionSway.createSway();
let dragVel = { vx: 0, vy: 0 };
if (api && api.onDragMotion) api.onDragMotion((v) => { if (v) dragVel = { vx: +v.vx || 0, vy: +v.vy || 0 }; });

function startDrag() {
  if (State.dragging) return;
  State.dragging = true;
  sway.reset();
  touchFx = null;
  if (animations.idle) {
    setAnim('idle');   // use idle frame while dangling
    charSprite.stop(); // freeze frame
    charSprite.currentFrame = 0;
  }
  overlayG.clear();
  particles.length = 0;
  if (bubbles.grab) showBubble(bubbles.grab, 3500);
}

function endDrag() {
  if (!State.dragging) return;
  State.dragging = false;
  if (charSprite) charSprite.rotation = 0;
  setAnim('idle');
  if (bubbles.drop) showBubble(bubbles.drop, 2000);
}

// IPC from Electron main (window move events)
if (api && api.onWindowDragState) {
  api.onWindowDragState(({ dragging }) => {
    // In 3D la finestra si sposta con la maniglia e non c'e' uno sprite da far penzolare.
    if (window.__threeVisible) return;
    if (dragging) startDrag();
    else endDrag();
  });
}

// ── Segue il mouse ──────────────────────────────────────────────────────────
// Uno sprite non gira la testa: a riposo si volta verso il lato del cursore,
// solo se ci resta per un po', cosi' non si specchia a ogni passaggio.
const FACE_MARGIN_PX = 60;
const FACE_HOLD_MS = 700;
let cursor = null;
let faceWant = 0;
let faceHeld = 0;
if (api && api.onCursor) api.onCursor((c) => { if (!window.__companionTest) cursor = c; });

function faceCursor(deltaMS) {
  if (!cursor || !cursor.follow) { faceHeld = 0; return; }
  const center = stageCenterX();
  const want = cursor.x > center + FACE_MARGIN_PX ? 1 : cursor.x < center - FACE_MARGIN_PX ? -1 : 0;
  if (want === 0 || want === State.dir) { faceWant = 0; faceHeld = 0; return; }
  if (want !== faceWant) { faceWant = want; faceHeld = 0; }
  faceHeld += deltaMS;
  if (faceHeld >= FACE_HOLD_MS) { State.dir = want; faceHeld = 0; faceWant = 0; }
}

// ── Il mouse sull'avatar ────────────────────────────────────────────────────
// Un punto e' sull'avatar se il pixel dello sprite li' non e' trasparente:
// e' cio' che fa passare i clic sul resto della finestra. Si legge un pixel
// alla volta dall'immagine della strip, senza copiarla tutta in memoria.
const hitCanvas = document.createElement('canvas');
hitCanvas.width = hitCanvas.height = 1;
const hitCtx = hitCanvas.getContext('2d', { willReadFrequently: true });
const HIT_ALPHA = 24;

window.hitTest2D = (x, y) => {
  if (!charSprite) return charC.children.length > 0 && charC.getBounds().rectangle.contains(x, y);
  const tex = charSprite.texture;
  const local = charSprite.toLocal(new PIXI.Point(x, y));
  const u = local.x + charSprite.anchor.x * tex.frame.width;
  const v = local.y + charSprite.anchor.y * tex.frame.height;
  if (u < 0 || v < 0 || u >= tex.frame.width || v >= tex.frame.height) return false;
  const source = tex.source && tex.source.resource;
  if (!source) return true;
  try {
    hitCtx.clearRect(0, 0, 1, 1);
    hitCtx.drawImage(source, Math.floor(tex.frame.x + u), Math.floor(tex.frame.y + v), 1, 1, 0, 0, 1, 1);
    return hitCtx.getImageData(0, 0, 1, 1).data[3] > HIT_ALPHA;
  } catch (_) {
    // Immagine di un'altra origine senza CORS: si ripiega sul riquadro.
    return true;
  }
};

// Finche' companion-3d.js non sceglie un avatar vale il 2D (anche la sagoma di ripiego).
window.CompanionInput.setProbe(window.hitTest2D);

// ── Tocchi (Blocco 5b) ──────────────────────────────────────────────────────
// La zona viene dall'altezza del punto nel fotogramma: le righe le puo' dare
// il pacchetto (sprites.json, "touchZones"), altrimenti la tabella "full" di
// touch.js, misurata su una figura intera di circa sei teste.
let touchTable = 'full';
window.zone2D = (x, y) => {
  if (!charSprite || window.__threeVisible) return null;
  const tex = charSprite.texture;
  const local = charSprite.toLocal(new PIXI.Point(x, y));
  const v = local.y + charSprite.anchor.y * tex.frame.height;
  return window.CompanionTouch.zoneFromHeight(v / tex.frame.height, touchTable);
};
window.CompanionInput.setZoneProbe(window.zone2D);

// Le strip non hanno gesti per ogni reazione: un'animazione del pacchetto
// (se manca, setAnim ripiega su idle) piu' un movimento del contenitore.
const TOUCH_2D = {
  pat:      { anim: 'happy', fx: 'tilt' },
  flinch:   { anim: null,    fx: 'jolt' },
  giggle:   { anim: 'happy', fx: 'wobble' },
  hop:      { anim: 'happy', fx: 'hop' },
  shy:      { anim: 'think', fx: 'shrink' },
  scold:    { anim: 'think', fx: 'shake' },
  turnaway: { anim: 'idle',  fx: 'turn' },
};
let touchFx = null;   // { name, start, ms }
let touchAnimTimer = null;

const ease = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/** Il movimento della reazione, sul contenitore: i rami del tick toccano solo lo sprite. */
function applyTouchFx(groundY) {
  charC.rotation = 0;
  charC.pivot.set(0, 0);
  charC.scale.set(1, 1);
  charC.alpha = 1;
  charC.y = groundY;
  if (!touchFx) return;
  const ms = performance.now() - touchFx.start;
  const p = ms / touchFx.ms;
  if (p >= 1) { touchFx = null; return; }
  const env = ease(p / 0.15) * ease((1 - p) / 0.2);
  const tt = ms / 1000;
  switch (touchFx.name) {
    case 'tilt': charC.rotation = 0.09 * Math.sin(Math.PI * p) * State.dir; break;
    case 'jolt': {
      const j = p < 0.1 ? p / 0.1 : Math.exp(-(p - 0.1) * 5);
      charC.pivot.x = 8 * j * State.dir;
      charC.rotation = -0.06 * j * State.dir;
      break;
    }
    case 'wobble':
      charC.rotation = 0.05 * Math.sin(tt * 28) * env;
      charC.y = groundY + 2 * Math.abs(Math.sin(tt * 28)) * env;
      break;
    case 'hop': charC.y = groundY - 26 * Math.sin(Math.PI * Math.min(1, p / 0.7)) * (p < 0.7 ? 1 : 0); break;
    case 'shrink':
      charC.scale.y = 1 - 0.05 * env;
      charC.rotation = 0.04 * env * State.dir;
      charC.pivot.x = 5 * env * State.dir;
      break;
    case 'shake': charC.pivot.x = 5 * Math.sin(tt * 40) * (1 - p); break;
    case 'turn': {
      // Si gira: lo sprite si stringe fino a sparire e torna specchiato, un
      // po' piu' scuro, come di spalle; alla fine si rigira.
      const away = ease(p / 0.08) * (1 - ease((p - 0.9) / 0.08));
      charC.scale.x = Math.cos(Math.PI * away);
      charC.alpha = 1 - 0.15 * away;
      break;
    }
  }
}

// La reazione decisa dal main (touch-react.js). Solo da fermo: mentre
// cammina, fuma o saluta il gesto in corso vince.
window.addEventListener('companion-touch', (e) => {
  if (window.__threeVisible || State.dragging || !charSprite) return;
  const r = e.detail && e.detail.reaction;
  if (!r) return;
  if (State.name !== 'idle' && State.name !== 'sit' && State.name !== 'happy' && State.name !== 'think') return;
  if (r.off) {
    if (State.name === 'sit') return;
    setAnim('happy');
    setTimeout(() => { if (!State.dragging && State.name === 'happy') setAnim('idle'); }, 1500);
    return;
  }
  const how = TOUCH_2D[r.slot] || { anim: 'happy', fx: null };
  // Seduto resta seduto: niente saltello, il resto si', sulla seduta.
  if (State.perched && how.fx === 'hop') { if (r.line) showBubble(r.line, 2600); return; }
  if (how.fx) touchFx = { name: how.fx, start: performance.now(), ms: Math.max(600, r.ms) };
  if (how.anim && !State.perched) {
    setAnim(how.anim);
    clearTimeout(touchAnimTimer);
    const anim = State.name;
    touchAnimTimer = setTimeout(() => { if (!State.dragging && State.name === anim && anim !== 'idle') setAnim('idle'); }, r.ms);
  }
  if (r.line) showBubble(r.line, 2600);
});

// Mappa animazioni AI (SYSTEM_PROMPT) -> animazioni 2D reali.
// Supporta sia action.animation (nuovo) che action.type (legacy).
const ANIM_ALIAS = {
  'idle': 'idle', 'wave': 'wave', 'think': 'think', 'sit': 'sit', 'smoke': 'smoke',
  'click': 'click', 'happy': 'happy',
  'walk-to': 'walk', 'run-to': 'run', 'walk': 'walk', 'run': 'run',
  'scroll': 'think', 'open-file': 'sit', 'search': 'think',
  'relaxed': 'think',
  // Gesti senza una strip propria nei pacchetti di oggi.
  'sit-edge': 'sit', 'stretch': 'happy', 'yawn': 'think', 'doze': 'sit', 'dance': 'happy',
};
function resolveAnimKey(action) {
  if (!action) return 'idle';
  const raw = action.animation || action.type || 'idle';
  return ANIM_ALIAS[raw] || 'idle';
}

// Un fumetto dal main senza animazione, in 2D e in 3D (il fumetto e' lo
// stesso): "Ti ascolto…" finche' il microfono e' aperto. Testo vuoto: via.
if (api && api.onCompanionBubble) {
  api.onCompanionBubble((b) => {
    if (!b || !b.text) { clearTimeout(bubbleTimer); bubbleEl.classList.remove('show'); return; }
    showBubble(String(b.text).slice(0, 80), Math.min(Number(b.ms) || 2800, 120000));
  });
}

// ── IPC Animation Triggers ───────────────────────────────────────────────
if (api && api.onTriggerAnimation) {
  api.onTriggerAnimation((action) => {
    if (!action || State.dragging) return;
    // Se siamo in modalità 3D, ignora il branch 2D (lo gestisce il modulo Three)
    if (window.__threeVisible) return;
    const key = resolveAnimKey(action);
    // I gesti a riposo portano il proprio fumetto, anche vuoto: un'occhiata in
    // giro non e' "Sto pensando...".
    const say = (text) => {
      const line = typeof action.bubble === 'string' ? action.bubble : text;
      if (line) showBubble(line);
    };
    switch (key) {
      // Lo spostamento vero lo fa il main muovendo la finestra sul desktop:
      // qui si riproduce solo il ciclo di passo (vedi il ramo WALK del ticker).
      case 'walk':
        setAnim('walk'); break;
      case 'run':
        setAnim('run'); break;
      case 'wave':
        setAnim('wave');
        say(bubbles.wave);
        setTimeout(() => setAnim('idle'), 3000); break;
      case 'think':
        setAnim('think');
        say(bubbles.think); break;
      case 'sit':
        setAnim('sit');
        say(bubbles.sit); break;
      case 'smoke':
        setAnim('smoke');
        // Un avatar senza la strip smoke resta in idle: niente fumo nel fumetto.
        if (animations.smoke) say(bubbles.smoke); break;
      case 'click':
        setAnim('click');
        setTimeout(() => { if (!State.dragging) setAnim('idle'); }, 2500); break;
      case 'happy':
        setAnim('happy');
        say(bubbles.happy);
        setTimeout(() => { if (!State.dragging) setAnim('idle'); }, 3000); break;
      case 'idle':
        setAnim('idle'); break;
      default:
        setAnim('idle');
    }
  });
}

// Il verso lo decide il main, che conosce l'area di lavoro: lo sprite si
// specchia di conseguenza invece di camminare all'indietro.
if (api && api.onCompanionFacing) {
  api.onCompanionFacing((data) => {
    if (window.__threeVisible) return;
    const dir = data && data.dir;
    if (dir === 1 || dir === -1) State.dir = dir;
  });
}

// ── Chat click ──────────────────────────────────────────────────────────────
document.getElementById('click-zone').addEventListener('click', () => {
  if (api && api.toggleChat) api.toggleChat();
  setAnim('wave');
  setTimeout(() => setAnim('idle'), 2000);
});

// ── Model switcher ──────────────────────────────────────────────────────────
document.getElementById('switch-zone').addEventListener('click', () => {
  const modelMenu = document.getElementById('model-menu');
  const open = modelMenu.style.display === 'none';
  modelMenu.style.display = open ? 'block' : 'none';
  document.body.classList.toggle('menu-open', open);
});

// ── Caricamento di un avatar ─────────────────────────────────────────────────
// Ogni caricamento ha un numero: scegliendo un altro avatar prima che il
// precedente abbia finito, le texture arrivate in ritardo vengono liberate
// invece di finire nell'avatar nuovo.
let loadSeq2D = 0;

// Anche dal 3D: le strip di un avatar 2D occupano ~40 MB di memoria video, e
// restavano caricate mentre si usava un modello VRM.
// I fumetti tornano neutri: i "Nya!" di un pacchetto non devono passare a un
// avatar Live2D o 3D.
window.unload2DAvatar = () => { loadSeq2D++; disposeStrips(); bubbles = { ...DEFAULT_BUBBLES }; };

function disposeStrips() {
  if (charSprite) { charC.removeChild(charSprite); charSprite = null; }
  for (const sprite of Object.values(animations)) sprite.destroy();
  for (const tex of Object.values(textureCache)) tex.destroy(false);
  for (const base of Object.values(stripTextures)) base.destroy();
  animations = {}; textureCache = {}; stripTextures = {}; STRIPS = {};
  charC.removeChildren();
}

/**
 * Mostra un avatar 2D.
 * @param {{animations: Object}} manifest pacchetto companion-sprites/1
 * @param {string} baseUrl cartella dei PNG, con la barra finale
 */
window.load2DAvatar = async (manifest, baseUrl) => {
  const seq = ++loadSeq2D;
  const next = manifest && manifest.animations;
  if (!next || !next.idle) throw new Error("il pacchetto non ha l'animazione idle");
  const names = Object.keys(next);
  const bases = await Promise.all(names.map(name => loadOneStrip(next[name], baseUrl)));
  if (seq !== loadSeq2D) { bases.forEach(b => b.destroy()); return; }

  disposeStrips();
  STRIPS = next;
  names.forEach((name, i) => { stripTextures[name] = bases[i]; });
  for (const name of names) animations[name] = buildAnimation(name, STRIPS[name].fps || 0.1);
  bubbles = packBubbles(manifest);
  touchTable = window.CompanionTouch.heightTableFrom(manifest.touchZones) || 'full';
  setAnim('wave');
  if (bubbles.hello) showBubble(bubbles.hello, 2500);
  setTimeout(() => { if (State.name === 'wave') setAnim('idle'); }, 2600);
};

// Sagoma di ripiego, se un avatar non si carica: meglio di una finestra vuota.
window.show2DPlaceholder = () => {
  disposeStrips();
  const g = new PIXI.Graphics();
  g.roundRect(-20, -60, 40, 70, 8).fill({ color: 0x9ab7a4, alpha: 0.9 });
  g.circle(-8, -68, 8).circle(8, -68, 8).fill({ color: 0x5a7a63 });
  charC.addChild(g);
};

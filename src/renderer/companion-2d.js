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
window.app = new PIXI.Application({
  resizeTo: window,
  backgroundAlpha: 0,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
});
// 30 fps bastano: le strip vanno da 3 a 13 fotogrammi al secondo e il resto
// (respiro, sobbalzo) e' lento. A 60 il companion consumava il doppio stando fermo.
app.ticker.maxFPS = 30;
// Nitidezza in enlarge: filtro lineare + mipmaps (impostate per-strip al load)
try {
  if (PIXI.settings && PIXI.SCALE_MODES) PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;
} catch (_) {}
document.getElementById('pixi-mount').appendChild(app.view);

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
charC.x = window.innerWidth / 2;
charC.y = window.innerHeight - 12;

// Ground shadow
shadowG.beginFill(0x000000, 0.18);
shadowG.drawEllipse(0, 0, 28, 6);
shadowG.endFill();
shadowG.x = window.innerWidth / 2;
shadowG.y = window.innerHeight - 12;

// ── Strip ───────────────────────────────────────────────────────────────────
// Un avatar 2D e' un pacchetto di sprite (formato companion-sprites/1): per
// ogni animazione un PNG e i riquadri [x, y, w, h] dei fotogrammi. Li genera
// scripts/build-strips.js: fotogrammi ritagliati e alti al massimo 480 px.
// L'avatar integrato arriva da assets/strips/sprites.js, quelli importati da
// avatar://. Un'immagine singola importata e' un pacchetto con la sola idle e
// nessun riquadro: si usa l'immagine intera.
let STRIPS = {};           // anim -> { file, fps, frames }
let stripTextures = {};    // anim -> PIXI.BaseTexture
let textureCache = {};     // key -> PIXI.Texture

function loadOneStrip(meta, baseUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const baseTex = PIXI.BaseTexture.from(img);
        // Mipmap: nitidezza quando la finestra rimpicciolisce il personaggio.
        if (PIXI.MIPMAP_MODES) baseTex.mipmap = PIXI.MIPMAP_MODES.ON;
        resolve(baseTex);
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
  const tex = f ? new PIXI.Texture(base, new PIXI.Rectangle(f[0], f[1], f[2], f[3])) : new PIXI.Texture(base);
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
    overlayG.beginFill(0xd4dbd6, p.a);
    overlayG.drawCircle(p.x, p.y, p.r);
    overlayG.endFill();
  }
}

// ── State Machine ───────────────────────────────────────────────────────────
const State = {
  name:      'idle',
  posX:      90,
  dir:       1,       // 1 = right, -1 = left (lo decide il main durante la camminata)
  dragging:  false,
  smokeTick: 0,
};

let animations = {};   // filled after load
let currentAnim = null;
let charSprite  = null;

let baseScale   = 1;     // ricalcolata a ogni frame da updateScale()

function setAnim(name) {
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
  const targetH = Math.min(window.innerHeight * 0.78, window.innerWidth * 1.15);
  baseScale = targetH / sh;
}

// ── Main Ticker ─────────────────────────────────────────────────────────────
let t = 0;

app.ticker.add((delta) => {
  t += delta * 0.045;

  if (!charSprite) return;

  updateScale();

  const groundY = window.innerHeight - 8;
  const centerX = window.innerWidth / 2;

  if (!State.dragging && State.name !== 'walk' && State.name !== 'run') {
    State.posX = centerX;
  }

  charC.x = State.posX;
  charC.y = groundY;

  const bob    = Math.sin(t * 3.2) * 1.8;
  const breath = 1 + Math.sin(t * 2.0) * 0.014;

  // I gesti a riposo (fumare, guardarsi attorno, sonnecchiare) li decide il
  // main in idle-life.js, uguali per il 2D e il 3D: qui c'era un "fuma" a
  // tempo fisso, contato in frame e quindi il doppio piu' lento a 30 fps.

  // ── DRAG STATE ────────────────────────────────────────────────────────
  if (State.dragging) {
    const swing = Math.sin(t * 9) * 0.18;
    charSprite.rotation = swing;
    charSprite.x = 0;
    charSprite.y = -22 + Math.sin(t * 5) * 3;   // float up
    charSprite.scale.set(baseScale * State.dir * 1.05, baseScale * 1.05);

    shadowG.alpha = 0.05;
    shadowG.scale.set(0.45);
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

    shadowG.alpha = 0.18;
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

    shadowG.alpha = 0.18;
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

    shadowG.alpha = 0.18; shadowG.scale.set(1); shadowG.x = State.posX;
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

    shadowG.alpha = 0.14; shadowG.scale.set(0.85); shadowG.x = State.posX;
    charC.x = State.posX;
    overlayG.clear();
    return;
  }

  // ── DEFAULT IDLE ──────────────────────────────────────────────────────
  charSprite.x = 0;
  charSprite.y = bob;
  charSprite.rotation = Math.sin(t * 1.6) * 0.02;
  charSprite.scale.set(baseScale * State.dir * breath, baseScale * breath);

  shadowG.alpha = 0.18; shadowG.scale.set(1); shadowG.x = State.posX;
  charC.x = State.posX;
  overlayG.clear();
});

// ── Drag & Drop ─────────────────────────────────────────────────────────────
function startDrag() {
  if (State.dragging) return;
  State.dragging = true;
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

// Also catch mouse events on the drag handle
const dragZone = document.getElementById('drag-zone');
dragZone.addEventListener('mousedown', () => startDrag());
window.addEventListener('mouseup', () => { if (State.dragging) endDrag(); });

// Mappa animazioni AI (SYSTEM_PROMPT) -> animazioni 2D reali.
// Supporta sia action.animation (nuovo) che action.type (legacy).
const ANIM_ALIAS = {
  'idle': 'idle', 'wave': 'wave', 'think': 'think', 'sit': 'sit', 'smoke': 'smoke',
  'click': 'click', 'happy': 'happy',
  'walk-to': 'walk', 'run-to': 'run', 'walk': 'walk', 'run': 'run',
  'scroll': 'think', 'open-file': 'sit', 'search': 'think',
  'relaxed': 'think',
};
function resolveAnimKey(action) {
  if (!action) return 'idle';
  const raw = action.animation || action.type || 'idle';
  return ANIM_ALIAS[raw] || 'idle';
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
  modelMenu.style.display = modelMenu.style.display === 'none' ? 'block' : 'none';
});

// ── Mouse Edge Highlight ───────────────────────────────────────────────────
window.addEventListener('mousemove', (e) => {
  const margin = 20;
  const w = window.innerWidth;
  const h = window.innerHeight;

  const near = (e.clientX < margin || e.clientX > w - margin || e.clientY < margin || e.clientY > h - margin);
  if (near) {
    document.body.classList.add('near-edge');
  } else {
    document.body.classList.remove('near-edge');
  }
});

// ── Caricamento di un avatar ─────────────────────────────────────────────────
// Ogni caricamento ha un numero: scegliendo un altro avatar prima che il
// precedente abbia finito, le texture arrivate in ritardo vengono liberate
// invece di finire nell'avatar nuovo.
let loadSeq2D = 0;

// Anche dal 3D: le strip di un avatar 2D occupano ~40 MB di memoria video, e
// restavano caricate mentre si usava un modello VRM.
window.unload2DAvatar = () => { loadSeq2D++; disposeStrips(); };

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
  setAnim('wave');
  if (bubbles.hello) showBubble(bubbles.hello, 2500);
  setTimeout(() => { if (State.name === 'wave') setAnim('idle'); }, 2600);
};

// Sagoma di ripiego, se un avatar non si carica: meglio di una finestra vuota.
window.show2DPlaceholder = () => {
  disposeStrips();
  const g = new PIXI.Graphics();
  g.beginFill(0x9ab7a4, 0.9);
  g.drawRoundedRect(-20, -60, 40, 70, 8);
  g.endFill();
  g.beginFill(0x5a7a63);
  g.drawCircle(-8, -68, 8);
  g.drawCircle(8, -68, 8);
  g.endFill();
  charC.addChild(g);
};

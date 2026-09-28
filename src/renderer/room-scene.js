// room-scene.js — la scena della stanza: sfondo, pavimento, luci che seguono
// l'ora, il meteo e l'umore. Sul desktop non c'e' niente di tutto questo: la
// finestra resta trasparente e le luci tornano quelle di sempre.
//
// Scene:
// - studio: fondale a gradiente e pavimento, senza file da scaricare;
// - giardino: il cielo di Sky.js con il sole vero dell'ora, prato, stelle di
//   notte, pioggia e neve dal meteo;
// - quelle in modelli-3d/scenes/scenes.json: foto HDRI a 360 gradi proiettate
//   su un pavimento (GroundedSkybox), una per fase del giorno.
//
// I numeri della luce stanno in scene-light.js, puro e con i suoi test.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { sunPosition, lightFor, weatherEffect, moodTint } from './scene-light.js';

const BUILTIN_SCENES = [
  { id: 'studio', label: 'Studio', kind: 'studio' },
  { id: 'giardino', label: 'Giardino', kind: 'sky', outdoor: true },
];
const LIGHT_EVERY_S = 2;       // la luce si ricalcola ogni 2 s: l'ora cambia piano
const BLEND_PER_S = 1.5;       // e le luci ci arrivano sfumando
const RAIN_DROPS = 1400;
const SNOW_FLAKES = 900;
const WEATHER_BOX = { x: 7, y: 9, z: 7 };

/** Direzione del sole nel mondo: la camera guarda verso nord (-Z), l'avatar verso sud. */
function sunDirection(elevation, azimuth, out = new THREE.Vector3()) {
  return out.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), -Math.cos(elevation) * Math.cos(azimuth)).normalize();
}

function gradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function paintGradient(texture, top, bottom) {
  const canvas = /** @type {HTMLCanvasElement} */ (texture.image);
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  const css = (c) => 'rgb(' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',') + ')';
  g.addColorStop(0, css(top));
  g.addColorStop(1, css(bottom));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  texture.needsUpdate = true;
}

/** Pavimento rotondo che sfuma nel fondale, come in uno studio fotografico. */
function studioFloor() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  // alphaMap legge il verde: bianco pieno al centro, nero sul bordo.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.35, '#fff');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const material = new THREE.MeshStandardMaterial({ color: 0xd9d2cb, roughness: 0.95, alphaMap: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(9, 64), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -2;
  return mesh;
}

/** Prato: un piano grande con un po' di rumore, che sfuma nella nebbia all'orizzonte. */
function grassGround() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = Math.random();
    img.data[i * 4] = 78 + n * 16;
    img.data[i * 4 + 1] = 122 + n * 24;
    img.data[i * 4 + 2] = 60 + n * 12;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(120, 120);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map, roughness: 1 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.001;
  return mesh;
}

function stars() {
  const positions = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) {
    // Solo la meta' alta del cielo.
    const u = Math.random() * 2 * Math.PI;
    const v = Math.acos(Math.random());
    positions.set([Math.sin(v) * Math.cos(u) * 700, Math.cos(v) * 700 + 20, Math.sin(v) * Math.sin(u) * 700], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  return new THREE.Points(geometry, material);
}

/** Pioggia (segmenti) o neve (punti), in una scatola intorno all'avatar. */
function precipitation(kind) {
  const count = kind === 'rain' ? RAIN_DROPS : SNOW_FLAKES;
  const perDrop = kind === 'rain' ? 2 : 1;
  const positions = new Float32Array(count * perDrop * 3);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seeds.set([(Math.random() * 2 - 1) * WEATHER_BOX.x, Math.random() * WEATHER_BOX.y, (Math.random() * 2 - 1) * WEATHER_BOX.z], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const object = kind === 'rain'
    ? new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xaec4dd, transparent: true, opacity: 0.45, depthWrite: false }))
    : new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.9, depthWrite: false }));
  object.frustumCulled = false;
  const speed = kind === 'rain' ? 9 : 0.9;
  let time = 0;
  return {
    object,
    /** amount: 0..1, quante gocce si vedono. */
    update(delta, amount) {
      time += delta;
      const visible = Math.round(count * amount);
      object.visible = visible > 0;
      if (!object.visible) return;
      for (let i = 0; i < visible; i++) {
        const sx = seeds[i * 3], sy = seeds[i * 3 + 1], sz = seeds[i * 3 + 2];
        const y = WEATHER_BOX.y - ((WEATHER_BOX.y - sy + time * speed) % WEATHER_BOX.y);
        const drift = kind === 'rain' ? 0 : Math.sin(time * 0.8 + i) * 0.25;
        positions[i * perDrop * 3] = sx + drift;
        positions[i * perDrop * 3 + 1] = y;
        positions[i * perDrop * 3 + 2] = sz;
        if (kind === 'rain') positions.set([sx, y + 0.28, sz], i * 6 + 3);
      }
      geometry.setDrawRange(0, visible * perDrop);
      geometry.attributes.position.needsUpdate = true;
    },
  };
}

/**
 * @param {{ scene: THREE.Scene, renderer: THREE.WebGLRenderer, hemiLight: THREE.HemisphereLight,
 *   dirLight: THREE.DirectionalLight, listScenes?: () => Promise<any[]> }} ctx
 */
export function createRoomScene({ scene, renderer, hemiLight, dirLight, listScenes }) {
  const defaults = {
    hemiSky: hemiLight.color.clone(), hemiGround: hemiLight.groundColor.clone(), hemiIntensity: hemiLight.intensity,
    dirColor: dirLight.color.clone(), dirIntensity: dirLight.intensity, dirPosition: dirLight.position.clone(),
  };
  const root = new THREE.Group();
  root.name = 'room-scene';
  const lamp = new THREE.PointLight(0xffc98a, 0, 6, 1.5);
  lamp.position.set(-1.2, 1.9, 1.4);
  root.add(lamp);

  let scenes = [...BUILTIN_SCENES];
  let active = false;
  let current = null;             // { id, kind, ... } della scena montata
  let parts = null;               // oggetti della scena montata
  let hdrCache = new Map();       // file -> texture
  let hdrLoading = null;
  let mood = null;
  let weather = null;
  let place = {};
  let forcedDate = null;          // per l'audit: un'ora finta
  let sinceLight = LIGHT_EVERY_S;
  let target = null;              // luce verso cui si sfuma
  const sunDir = new THREE.Vector3();
  const rain = precipitation('rain');
  const snow = precipitation('snow');
  root.add(rain.object, snow.object);
  let weatherNow = weatherEffect(null);

  // Le scene HDRI le elenca il main (modelli-3d/scenes/scenes.json), gia'
  // controllate: se non ce ne sono restano le integrate.
  async function loadManifest() {
    try {
      const extra = listScenes ? await listScenes() : [];
      scenes = [...BUILTIN_SCENES, ...extra.map(s => ({ ...s, kind: 'hdri' }))];
    } catch (_) { /* nessuna scena HDRI: restano le integrate */ }
  }
  const ready = loadManifest();

  function clearParts() {
    if (!parts) return;
    for (const obj of parts.objects) {
      root.remove(obj);
      obj.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); if (o.material.alphaMap) o.material.alphaMap.dispose(); o.material.dispose(); }
      });
    }
    if (parts.background) parts.background.dispose();
    parts = null;
    scene.background = null;
    scene.environment = null;
    scene.fog = null;
  }

  function mount(def) {
    clearParts();
    current = def;
    parts = { objects: [], background: null, sky: null, stars: null, skybox: null, variant: null };
    if (def.kind === 'studio') {
      parts.background = gradientTexture();
      scene.background = parts.background;
      parts.objects.push(studioFloor());
    } else if (def.kind === 'sky') {
      const sky = new Sky();
      sky.scale.setScalar(900);
      parts.sky = sky;
      parts.stars = stars();
      parts.objects.push(sky, parts.stars, grassGround());
      scene.fog = new THREE.Fog(0xbfd1e5, 40, 380);
    } else if (def.kind === 'hdri') {
      // La foto arriva quando e' caricata: intanto un colore neutro.
      scene.background = new THREE.Color(0x1d1b22);
    }
    for (const obj of parts.objects) root.add(obj);
    // Tone mapping per cielo e foto HDR, che hanno luce "vera"; lo studio e'
    // gia' nei colori dello schermo. L'avatar non ne risente (vedi
    // keepAvatarLook in companion-3d.js).
    renderer.toneMapping = def.kind === 'studio' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    sinceLight = LIGHT_EVERY_S;
    target = null;
  }

  /** La foto HDR giusta per l'ora: day, dusk o night, se la scena le ha. */
  function hdriFile(def, light, morning) {
    const v = def.variants;
    if (light.night > 0.5 && v.night) return v.night;
    if (light.sunIntensity < 1.3 && light.night < 0.5 && (v.dusk || v.dawn)) return morning ? (v.dawn || v.dusk) : (v.dusk || v.dawn);
    return v.day;
  }

  async function showHdri(def, file) {
    if (!parts || parts.variant === file || hdrLoading === file) return;
    hdrLoading = file;
    try {
      let texture = hdrCache.get(file);
      if (!texture) {
        texture = await new RGBELoader().loadAsync('vrm://scenes/' + encodeURIComponent(file));
        texture.mapping = THREE.EquirectangularReflectionMapping;
        hdrCache.set(file, texture);
      }
      if (!parts || current !== def) return;
      if (parts.skybox) { root.remove(parts.skybox); parts.skybox.geometry.dispose(); parts.skybox.material.dispose(); parts.objects = parts.objects.filter(o => o !== parts.skybox); }
      const skybox = new GroundedSkybox(texture, def.height, def.radius || 100);
      skybox.position.y = def.height - 0.01;
      parts.skybox = skybox;
      parts.objects.push(skybox);
      root.add(skybox);
      scene.background = null;
      scene.environment = texture;
      parts.variant = file;
    } catch (error) {
      console.warn('Scena ' + def.id + ': foto ' + file + ' non caricata:', error.message);
    } finally {
      if (hdrLoading === file) hdrLoading = null;
    }
  }

  /** Calcola dove devono arrivare le luci adesso. */
  function computeLight() {
    const date = forcedDate || new Date();
    const sun = sunPosition(date, place);
    const light = lightFor(sun.elevation);
    const tint = moodTint(mood);
    weatherNow = weatherEffect(current && (current.outdoor || current.kind === 'sky') ? weather : null);
    const dim = weatherNow.dim;
    const morning = date.getHours() < 13;
    // Di notte la luce viene dalla luna, dal lato opposto e sopra l'orizzonte.
    const lightElevation = light.night > 0.5 ? Math.max(0.35, -sun.elevation) : Math.max(0.12, sun.elevation);
    const lightAzimuth = light.night > 0.5 ? sun.azimuth + Math.PI : sun.azimuth;
    return {
      sun, light, morning,
      hemiSky: new THREE.Color().setRGB(light.skyColor[0] * tint[0], light.skyColor[1] * tint[1], light.skyColor[2] * tint[2]),
      hemiGround: new THREE.Color().setRGB(...light.groundColor),
      hemiIntensity: light.hemiIntensity * (0.85 + 0.15 * dim),
      dirColor: new THREE.Color().setRGB(light.sunColor[0] * tint[0], light.sunColor[1] * tint[1], light.sunColor[2] * tint[2]),
      dirIntensity: light.sunIntensity * dim,
      dirDirection: sunDirection(lightElevation, lightAzimuth),
      // Le foto HDRI sono gia' esposte per la loro ora (quelle notturne con
      // tempi lunghi, quindi chiare): si scuriscono solo un po' di notte e col meteo.
      exposure: (current && current.kind === 'hdri' ? 1 - 0.4 * light.night : light.exposure) * (0.8 + 0.2 * dim),
      lamp: light.night * 1.4,
    };
  }

  function applyTargets(t, k) {
    hemiLight.color.lerp(t.hemiSky, k);
    hemiLight.groundColor.lerp(t.hemiGround, k);
    hemiLight.intensity += (t.hemiIntensity - hemiLight.intensity) * k;
    dirLight.color.lerp(t.dirColor, k);
    dirLight.intensity += (t.dirIntensity - dirLight.intensity) * k;
    dirLight.position.lerp(sunDir.copy(t.dirDirection).multiplyScalar(5), k);
    renderer.toneMappingExposure += (t.exposure - renderer.toneMappingExposure) * k;
    lamp.intensity += (t.lamp - lamp.intensity) * k;
  }

  function sceneExtras(t) {
    if (!current) return;
    const { light, sun } = t;
    if (current.kind === 'studio' && parts.background) {
      // Fondale: piu' chiaro in basso, con il colore del cielo dell'ora.
      const sky = t.hemiSky;
      const top = [0.2 + sky.r * 0.35, 0.2 + sky.g * 0.35, 0.22 + sky.b * 0.38].map(v => v * (1 - 0.55 * light.night));
      const bottom = [0.62 + sky.r * 0.2, 0.6 + sky.g * 0.2, 0.6 + sky.b * 0.2].map(v => v * (1 - 0.6 * light.night));
      paintGradient(parts.background, top, bottom);
    }
    if (parts.sky) {
      const u = parts.sky.material.uniforms;
      u.sunPosition.value.copy(sunDirection(sun.elevation, sun.azimuth));
      u.turbidity.value = light.turbidity + 8 * weatherNow.cloud;
      u.rayleigh.value = light.rayleigh * (1 - 0.6 * weatherNow.cloud);
      u.mieCoefficient.value = 0.005 + 0.02 * weatherNow.cloud;
      u.mieDirectionalG.value = 0.8 - 0.3 * weatherNow.cloud;
      scene.fog.color.setRGB(...light.skyColor).multiplyScalar(0.9 * (1 - 0.7 * light.night));
      scene.fog.near = weatherNow.fog ? 5 : 40;
      scene.fog.far = weatherNow.fog ? 60 : 380;
    }
    if (parts.stars) parts.stars.material.opacity = light.night * (1 - weatherNow.cloud);
    if (current.kind === 'hdri') showHdri(current, hdriFile(current, light, t.morning));
  }

  function restoreDefaults() {
    hemiLight.color.copy(defaults.hemiSky);
    hemiLight.groundColor.copy(defaults.hemiGround);
    hemiLight.intensity = defaults.hemiIntensity;
    dirLight.color.copy(defaults.dirColor);
    dirLight.intensity = defaults.dirIntensity;
    dirLight.position.copy(defaults.dirPosition);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
  }

  return {
    ready,
    /** Scene disponibili: le integrate e quelle HDRI del manifest. */
    list: () => scenes.map(({ id, label }) => ({ id, label })),
    current: () => (current ? current.id : null),

    /** Accende o spegne la stanza: sul desktop tutto torna trasparente. */
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        scene.add(root);
        mount(current || scenes[0]);
      } else {
        clearParts();
        scene.remove(root);
        restoreDefaults();
      }
    },

    /** Cambia scena; un id sconosciuto (scena tolta) torna alla prima. */
    setScene(id) {
      const def = scenes.find(s => s.id === id) || scenes[0];
      if (!active) { current = def; return def.id; }
      if (!current || current.id !== def.id) mount(def);
      return def.id;
    },

    setMood(next) { mood = next; sinceLight = LIGHT_EVERY_S; },
    /** Meteo da Open-Meteo (main.js); null lo spegne. place: latitudine e longitudine della citta'. */
    setWeather(next, nextPlace) {
      weather = next || null;
      place = nextPlace && Number.isFinite(nextPlace.latitude) ? { latitude: nextPlace.latitude, longitude: nextPlace.longitude } : {};
      sinceLight = LIGHT_EVERY_S;
    },
    /** Per l'audit: un'ora finta (Date), o null per quella vera. */
    setTime(date) { forcedDate = date instanceof Date ? date : null; sinceLight = LIGHT_EVERY_S; target = null; },

    update(delta) {
      if (!active || !current) return;
      sinceLight += delta;
      if (sinceLight >= LIGHT_EVERY_S) {
        sinceLight = 0;
        const first = !target;
        target = computeLight();
        sceneExtras(target);
        // Appena montata la scena le luci vanno subito al loro posto.
        if (first) applyTargets(target, 1);
      }
      applyTargets(target, Math.min(1, delta * BLEND_PER_S));
      const outdoor = current.outdoor || current.kind === 'sky';
      rain.update(delta, outdoor ? weatherNow.rain : 0);
      snow.update(delta, outdoor ? weatherNow.snow : 0);
    },

    debug() {
      return {
        active, scene: current && current.id, variant: parts && parts.variant,
        exposure: renderer.toneMappingExposure, sun: dirLight.intensity, hemi: hemiLight.intensity,
        night: target ? target.light.night : null, rain: rain.object.visible, snow: snow.object.visible,
      };
    },
  };
}

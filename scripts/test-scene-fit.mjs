// test-scene-fit.mjs — stima e sistemazione delle scene importate (scene-fit.js).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { guessScale, findFloor, freeSpot, autoFit, applyFit, withScale, withRotation, withSpot } from '../src/renderer/scene-fit.js';

let passed = 0;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, msg + ': ' + a + ' invece di ' + b);

/**
 * Una stanza in centimetri: 10 x 3 x 8 m, un tavolo al centro e un fondale
 * di cielo lontano e alto (come nell'aula di Sketchfab). La stanza non e'
 * centrata sull'origine del modello.
 */
function room() {
  const group = new THREE.Group();
  // Pavimento e quattro pareti separate, come nelle esportazioni OBJ: la mesh
  // piu' grande e' una parete sottile, non la stanza intera.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1000, 2, 800), new THREE.MeshBasicMaterial());
  floor.position.set(400, -21, -300);
  group.add(floor);
  for (const [w, d, x, z] of [[1000, 10, 400, 105], [1000, 10, 400, -705], [10, 800, -105, -300], [10, 800, 905, -300]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 300, d), new THREE.MeshBasicMaterial());
    wall.position.set(x, 150 - 20, z);
    group.add(wall);
  }
  const table = new THREE.Mesh(new THREE.BoxGeometry(160, 75, 90), new THREE.MeshBasicMaterial());
  table.position.set(400, 75 / 2 - 20, -300);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(900, 1500), new THREE.MeshBasicMaterial());
  sky.position.set(400, 600, -900);
  group.add(table, sky);
  group.updateMatrixWorld(true);
  return group;
}

// Scala: la stanza (non il cielo) diventa alta 4 m; un glTF gia' in metri resta com'e'.
{
  const model = room();
  near(guessScale(model, 'obj'), 4 / 300, 1e-9, 'scala di un OBJ in centimetri');
  near(guessScale(model, 'gltf'), 4 / 300, 1e-9, 'un glTF alto 300 unita\' non e\' in metri');
  model.scale.setScalar(0.01);
  model.updateMatrixWorld(true);
  near(guessScale(model, 'gltf'), 1, 1e-9, 'glTF in metri');
  // L'aula di Sketchfab in .glb: alta 10,2 "metri", con banchi di 2 m.
  model.scale.setScalar(0.034);
  model.updateMatrixWorld(true);
  near(guessScale(model, 'gltf'), 4 / 10.2, 1e-9, 'una stanza alta 10 m non e\' in metri');
  passed++;
}

// Pavimento: la faccia bassa della stanza, non il soffitto ne' il tavolo.
{
  const floor = findFloor(room());
  near(floor.y, -20, 0.5, 'quota del pavimento');
  near(floor.center.x, 400, 1, 'centro del pavimento in x');
  near(floor.center.z, -300, 1, 'centro del pavimento in z');
  passed++;
}

// Posto libero: al centro c'e' il tavolo, l'avatar va accanto.
{
  const model = room();
  const floor = findFloor(model);
  const spot = freeSpot(model, floor, 0.01);
  const dx = Math.abs(spot.x - 400), dz = Math.abs(spot.z + 300);
  assert.ok(dx > 80 + 29 || dz > 45 + 29, 'il posto non deve stare sotto il tavolo: ' + spot.toArray());
  assert.ok(Math.hypot(dx, dz) < 250, 'ma vicino al centro: ' + spot.toArray());
  // La camera guarda da +Z: il tavolo non deve stare fra lei e l'avatar.
  assert.ok(!(dx < 80 + 29 && spot.z < -300), 'non dietro il tavolo, visto dalla camera: ' + spot.toArray());
  near(spot.y, -20, 0.5, 'sul pavimento');
  passed++;
}

// autoFit + applyFit: il posto scelto finisce nell'origine, a y = 0.
{
  const model = room();
  const settings = autoFit(model, 'obj');
  const holder = new THREE.Group();
  holder.add(model);
  applyFit(holder, settings);
  const floor = findFloor(room());
  const spot = freeSpot(room(), floor, settings.scale);
  const world = spot.clone().applyMatrix4(model.matrixWorld);
  near(world.length(), 0, 1e-6, 'il posto dell\'avatar va nell\'origine');
  passed++;
}

// Scala, rotazione e nuovo posto tengono fermo il punto sotto l'avatar.
{
  const model = room();
  const holder = new THREE.Group();
  holder.add(model);
  let settings = { scale: 0.01, rotation: 0, offset: [-4, 0.2, 3] };
  const anchorOf = (s) => { applyFit(holder, s); return new THREE.Vector3().applyMatrix4(holder.matrixWorld.clone().invert()); };
  const anchor = anchorOf(settings);
  for (const next of [withScale(settings, 0.02), withRotation(settings, 90), withRotation(withScale(settings, 0.005), -45)]) {
    const moved = anchorOf(next);
    near(moved.distanceTo(anchor), 0, 1e-6, 'il punto sotto l\'avatar resta lo stesso');
  }
  assert.equal(withRotation(settings, -90).rotation, 270);
  // Clic su un punto del mondo: il punto del modello che stava li' va nell'origine.
  applyFit(holder, settings);
  const clicked = new THREE.Vector3(1.5, 0.3, -2);
  const local = clicked.clone().applyMatrix4(holder.matrixWorld.clone().invert());
  applyFit(holder, withSpot(settings, clicked));
  near(local.applyMatrix4(holder.matrixWorld).length(), 0, 1e-9, 'il punto cliccato va sotto l\'avatar');
  passed++;
}

console.log('=== scene-fit: ' + passed + ' scenari superati ===');

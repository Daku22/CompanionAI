import assert from 'node:assert/strict';
import * as THREE from 'three';
import { materialTokens, pickTextures, textureIndex, createFbxManager } from '../src/renderer/fbx-textures.js';
import { GLTFSpecularGlossinessPlugin } from '../src/renderer/gltf-specgloss.js';

let scenari = 0;

// I file di Shibahu (Sketchfab): materiali "<Parte>_mt", immagini "Shibahu_<parte>_dif".
const files = [
  'avatar://id/Texture/base_msk.png', 'avatar://id/Texture/Shibahu_body_dif.png',
  'avatar://id/Texture/Shibahu_cheek_msk.png', 'avatar://id/Texture/Shibahu_cosA_dif.png',
  'avatar://id/Texture/Shibahu_cosB_dif.png', 'avatar://id/Texture/Shibahu_face_dif.png',
  'avatar://id/Texture/Shibahu_hairA_dif.png', 'avatar://id/Texture/Shibahu_hairB_dif.png',
];
assert.deepEqual(materialTokens('Body_mt'), ['body']);
assert.deepEqual(materialTokens('HairA_mat'), ['haira']);
assert.deepEqual(materialTokens('sna2_main0'), ['sna2', 'main0']);
assert.deepEqual(materialTokens('_mt'), []);
scenari++;

assert.deepEqual(pickTextures('Body_mt', files), { map: files[1] });
assert.deepEqual(pickTextures('HairA_mt', files), { map: files[6] }, 'hairA non deve prendere hairB');
assert.deepEqual(pickTextures('CosB_mt', files), { map: files[4] });
assert.deepEqual(pickTextures('Face_mt', files), { map: files[5] });
// Nome del materiale fatto di piu' parole: devono comparire in fila.
assert.deepEqual(pickTextures('sna2_main0', ['t/sna2_main0_def_bsm.jpg', 't/sna2_main0_nrm.jpg']), { map: 't/sna2_main0_def_bsm.jpg' });
assert.deepEqual(pickTextures('main0_sna2', ['t/sna2_main0_def_bsm.jpg']), {});
scenari++;

// Solo una maschera: diventa trasparenza, non colore.
assert.deepEqual(pickTextures('Cheek_mt', files), { mask: files[2] });
// Nessuna immagine col nome del materiale: niente.
assert.deepEqual(pickTextures('lineA_mt', files), {});
assert.deepEqual(pickTextures('lambert2', files), {});
// Una normal map non e' il colore.
assert.deepEqual(pickTextures('Skin', ['t/skin_normal.png', 't/skin_albedo.png']), { map: 't/skin_albedo.png' });
assert.deepEqual(pickTextures('Skin', ['t/skin_normal.png']), {});
scenari++;

// Un FBX cita "C:\...\Big Boss.fbm\Face.PNG": il loader chiede solo il nome
// accanto al modello, il manager lo porta all'immagine importata.
const imported = ['avatar://id/Big%20Boss.fbm/face.png', 'avatar://id/textures/Body.tga'];
const index = textureIndex(imported);
assert.equal(index.get('face.png'), imported[0]);
assert.equal(index.get('body.tga'), imported[1]);
const manager = createFbxManager(imported);
assert.equal(manager.resolveURL('avatar://id/Face.PNG'), imported[0]);
assert.equal(manager.resolveURL('avatar://id/body.tga'), imported[1]);
assert.equal(manager.resolveURL('avatar://id/altro.png'), 'avatar://id/altro.png', 'un file assente resta com-e');
assert.equal(manager.resolveURL('blob:xyz'), 'blob:xyz');
assert.ok(manager.getHandler('avatar://id/body.tga'), 'le TGA hanno il loro loader');
scenari++;

// Il manager sa quando le texture sono arrivate: la riparazione le aspetta.
let settled = false;
manager.itemStart('a'); manager.itemStart('b');
const idle = manager.idle().then(() => { settled = true; });
manager.itemEnd('a');
await Promise.resolve();
assert.equal(settled, false, 'una texture ancora in arrivo tiene aperta l-attesa');
manager.itemEnd('b');
await idle;
assert.equal(settled, true);
scenari++;

// glTF specular-glossiness (Sketchfab): la texture diffusa diventa il colore,
// senza metallo.
const json = { materials: [
  { extensions: { KHR_materials_pbrSpecularGlossiness: { diffuseTexture: { index: 0 }, diffuseFactor: [1, 0.5, 1, 0.8], glossinessFactor: 0.25 } } },
  { pbrMetallicRoughness: {} },
] };
const assigned = [];
const parser = { json, assignTexture: async (params, slot, info, colorSpace) => { assigned.push([slot, info.index, colorSpace]); } };
const plugin = new GLTFSpecularGlossinessPlugin(parser);
assert.equal(plugin.getMaterialType(0), THREE.MeshStandardMaterial);
assert.equal(plugin.getMaterialType(1), null, 'i materiali normali restano al loader');
const params = {};
await plugin.extendMaterialParams(0, params);
assert.deepEqual(assigned, [['map', 0, THREE.SRGBColorSpace]]);
assert.equal(params.metalness, 0);
assert.equal(params.roughness, 0.75);
assert.equal(params.opacity, 0.8);
await plugin.extendMaterialParams(1, {});
assert.equal(assigned.length, 1);
scenari++;

console.log('=== Texture FBX e glTF: ' + scenari + ' scenari superati ===');

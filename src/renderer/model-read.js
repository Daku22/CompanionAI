// model-read.js — legge un modello 3D importato: glTF, FBX o OBJ con i suoi
// .mtl. Lo usano la stanza (room-scene.js, le scene importate) e gli oggetti
// (object-view.js, Blocco 10c).

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { createFbxManager, repairFbxTextures } from './fbx-textures.js';

/**
 * Legge un modello importato (una scena della stanza o un oggetto). Gli FBX e gli OBJ citano le
 * texture in modi diversi: il LoadingManager di fbx-textures.js le ridirige
 * alle immagini copiate con la scena.
 * @param {{ url: string, format: string, label: string, textures?: string[] }} def
 */
export async function readModel(def) {
  const textures = def.textures || [];
  if (def.format === 'gltf') return (await new GLTFLoader().loadAsync(def.url)).scene;
  const manager = createFbxManager(textures);
  let object;
  if (def.format === 'fbx') {
    object = await new FBXLoader(manager).loadAsync(def.url);
  } else {
    const baseUrl = def.url.slice(0, def.url.lastIndexOf('/') + 1);
    const res = await fetch(def.url);
    if (!res.ok) throw new Error('file non leggibile (' + res.status + ')');
    const text = await res.text();
    const loader = new OBJLoader(manager);
    const mtl = (text.match(/^mtllib[ \t]+(.+?)[ \t]*$/m) || [])[1];
    if (mtl) {
      try {
        const materials = await new MTLLoader(manager).setResourcePath(baseUrl).loadAsync(baseUrl + mtl.split('/').map(encodeURIComponent).join('/'));
        materials.preload();
        loader.setMaterials(materials);
      } catch (error) { console.warn('Scena ' + def.label + ': materiali non letti:', error.message); }
    }
    object = loader.parse(text);
    // Blender scrive in Kd il colore del materiale anche quando c'e' una
    // texture, e il colore la scurisce: in Blender la texture lo sostituisce.
    object.traverse(o => {
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        if (m.map && m.color) m.color.set(0xffffff);
      }
    });
  }
  await manager.idle();
  repairFbxTextures(object, textures);
  return object;
}

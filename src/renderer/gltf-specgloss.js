// Materiali glTF "specular-glossiness" (KHR_materials_pbrSpecularGlossiness).
//
// E' il formato dei materiali di molti glTF scaricati da Sketchfab prima del
// 2022. three.js non lo legge piu' dalla r147: il loader ignora l'estensione,
// il materiale resta senza texture e, senza pbrMetallicRoughness, diventa un
// metallo pieno (metalness 1), cioe' quasi nero. Qui l'estensione torna un
// MeshStandardMaterial: la texture diffusa fa da colore, la lucentezza da
// rugosita' al contrario, e niente metallo (lo speculare di questo formato
// non e' un metallo, e' un riflesso).

import * as THREE from 'three';

const NAME = 'KHR_materials_pbrSpecularGlossiness';

export class GLTFSpecularGlossinessPlugin {
  constructor(parser) {
    this.parser = parser;
    this.name = NAME;
  }

  _extension(materialIndex) {
    const def = this.parser.json.materials && this.parser.json.materials[materialIndex];
    return def && def.extensions && def.extensions[NAME];
  }

  getMaterialType(materialIndex) {
    return this._extension(materialIndex) ? THREE.MeshStandardMaterial : null;
  }

  extendMaterialParams(materialIndex, params) {
    const ext = this._extension(materialIndex);
    if (!ext) return Promise.resolve();
    const pending = [];
    const factor = Array.isArray(ext.diffuseFactor) ? ext.diffuseFactor : [1, 1, 1, 1];
    params.color = new THREE.Color().setRGB(factor[0], factor[1], factor[2], THREE.LinearSRGBColorSpace);
    params.opacity = factor[3];
    if (ext.diffuseTexture !== undefined) {
      pending.push(this.parser.assignTexture(params, 'map', ext.diffuseTexture, THREE.SRGBColorSpace));
    }
    params.metalness = 0;
    params.roughness = 1 - (typeof ext.glossinessFactor === 'number' ? ext.glossinessFactor : 1);
    return Promise.all(pending);
  }
}

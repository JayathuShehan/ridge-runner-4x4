// Replaces ez-tree's texture module (which eagerly loads ~20 images).
// We assign our own materials after generation, so placeholders are enough here.
import * as THREE from 'three';
const ph = new THREE.Texture();
export function getBarkTexture() { return ph; }
export function getLeafTexture() { return ph; }

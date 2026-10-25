import * as THREE from "three";
import XXH from "xxhashjs";

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const UP_DIR = new THREE.Vector3(0, 1, 0);
export const ZERO_VEC = new THREE.Vector3(0, 0, 0);
export const DEG2RAD = Math.PI / 180;

export const MAP_TILE_SIZE = 32;

export function xxh() {
    return XXH.h64(0x123456);
}
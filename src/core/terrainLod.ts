import * as THREE from 'three';
import { registerLod, setLabelSlot, triangleCount, type LodView } from './lod';

export interface TerrainLodOptions {
  name: string;
  /** Square field edge length, metres, centred on the origin. */
  size: number;
  heightAt: (x: number, z: number) => number;
  colorAt: (x: number, z: number, target: THREE.Color) => THREE.Color;
  material: THREE.Material;
  /** Chunks per side. */
  chunks: number;
  /** Grid segments per chunk side for each level, finest first. */
  levelSegments: readonly number[];
  /** Pick the coarsest level whose height error projects to at most this many pixels. */
  maxErrorPixels: number;
}

/** Spacing used to estimate surface normals from the height field, metres. */
const NORMAL_STEP = 0.2;
/** Skirts hang this far below a chunk's edge (plus its own error) to hide cracks between levels. */
const SKIRT_DEPTH = 0.3;
/** Height error is measured on a grid this many times finer than the finest level. */
const ERROR_OVERSAMPLE = 2;

interface Chunk {
  bounds: THREE.Box3;
  meshes: THREE.Mesh[];
  /** Max vertical deviation from the height field per level, metres. */
  errors: number[];
}

function surfaceNormal(heightAt: (x: number, z: number) => number, x: number, z: number, target: THREE.Vector3): THREE.Vector3 {
  const dx = heightAt(x + NORMAL_STEP, z) - heightAt(x - NORMAL_STEP, z);
  const dz = heightAt(x, z + NORMAL_STEP) - heightAt(x, z - NORMAL_STEP);
  return target.set(-dx, 2 * NORMAL_STEP, -dz).normalize();
}

/** Height of the triangulated chunk grid at (x, z), matching the index layout used in chunkGeometry. */
function gridHeight(heights: Float32Array, n: number, x0: number, z0: number, step: number, x: number, z: number): number {
  const fx = THREE.MathUtils.clamp((x - x0) / step, 0, n - 1e-6);
  const fz = THREE.MathUtils.clamp((z - z0) / step, 0, n - 1e-6);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const h = (a: number, b: number): number => heights[b * (n + 1) + a];
  // Cell split along the (i, j+1)-(i+1, j) diagonal.
  return u + v <= 1
    ? h(i, j) + u * (h(i + 1, j) - h(i, j)) + v * (h(i, j + 1) - h(i, j))
    : h(i + 1, j + 1) + (1 - u) * (h(i, j + 1) - h(i + 1, j + 1)) + (1 - v) * (h(i + 1, j) - h(i + 1, j + 1));
}

function chunkGeometry(options: TerrainLodOptions, x0: number, z0: number, chunkSize: number, n: number): { geometry: THREE.BufferGeometry; error: number } {
  const { heightAt, colorAt, size } = options;
  const step = chunkSize / n;
  const half = size / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const heights = new Float32Array((n + 1) * (n + 1));
  const normal = new THREE.Vector3();
  const color = new THREE.Color();
  const vertex = (x: number, y: number, z: number, nx: number, nz: number): number => {
    surfaceNormal(heightAt, nx, nz, normal);
    colorAt(nx, nz, color);
    positions.push(x, y, z);
    normals.push(normal.x, normal.y, normal.z);
    colors.push(color.r, color.g, color.b);
    // Same mapping as a field-sized PlaneGeometry rotated to lie flat.
    uvs.push((nx + half) / size, (half - nz) / size);
    return positions.length / 3 - 1;
  };

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      heights[j * (n + 1) + i] = heightAt(x, z);
      vertex(x, heights[j * (n + 1) + i], z, x, z);
    }
  }
  const at = (i: number, j: number): number => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) indices.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
  }

  // Vertical error of this level against the height field.
  let error = 0;
  const fine = n * ERROR_OVERSAMPLE;
  for (let j = 0; j <= fine; j++) {
    for (let i = 0; i <= fine; i++) {
      const x = x0 + (i / fine) * chunkSize;
      const z = z0 + (j / fine) * chunkSize;
      error = Math.max(error, Math.abs(heightAt(x, z) - gridHeight(heights, n, x0, z0, step, x, z)));
    }
  }

  // Skirts along the four edges, drawn from both sides.
  const edges: [number, number][][] = [
    Array.from({ length: n + 1 }, (_, i) => [i, 0]),
    Array.from({ length: n + 1 }, (_, i) => [i, n]),
    Array.from({ length: n + 1 }, (_, j) => [0, j]),
    Array.from({ length: n + 1 }, (_, j) => [n, j]),
  ];
  const drop = SKIRT_DEPTH + error;
  for (const edge of edges) {
    const below = edge.map(([i, j]) => {
      const x = x0 + i * step;
      const z = z0 + j * step;
      return vertex(x, heights[at(i, j)] - drop, z, x, z);
    });
    for (let k = 0; k < n; k++) {
      const a = at(...edge[k]);
      const b = at(...edge[k + 1]);
      indices.push(a, below[k], b, b, below[k], below[k + 1], a, b, below[k], b, below[k + 1], below[k]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, error };
}

const closest = new THREE.Vector3();
const eye = new THREE.Vector3();

/**
 * Height-field terrain split into chunks, each built at several grid
 * resolutions. Per frame each chunk shows the coarsest level whose measured
 * height error, projected at the chunk's distance, stays under
 * `maxErrorPixels` (chunked LOD). Normals come from the height field itself,
 * so coarse chunks keep the shading of fine relief. All chunks share one
 * label instance.
 */
export function createTerrainLod(options: TerrainLodOptions): { group: THREE.Group; fullDetailTriangles: number } {
  const { name, size, chunks, levelSegments, material } = options;
  const group = new THREE.Group();
  group.name = name;
  const chunkSize = size / chunks;
  const slot = { key: group, count: 1, name };
  const list: Chunk[] = [];
  let fullDetailTriangles = 0;

  for (let cz = 0; cz < chunks; cz++) {
    for (let cx = 0; cx < chunks; cx++) {
      const x0 = -size / 2 + cx * chunkSize;
      const z0 = -size / 2 + cz * chunkSize;
      const built = levelSegments.map((n) => chunkGeometry(options, x0, z0, chunkSize, n));
      const meshes = built.map(({ geometry }, level) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${name}-${cx}-${cz}-lod${level}`;
        mesh.receiveShadow = true;
        mesh.visible = level === 0;
        setLabelSlot(mesh, slot);
        group.add(mesh);
        return mesh;
      });
      const bounds = new THREE.Box3();
      meshes.forEach((mesh) => bounds.union(mesh.geometry.boundingBox!));
      list.push({ bounds, meshes, errors: built.map((b) => b.error) });
      fullDetailTriangles += triangleCount(meshes[0].geometry);
    }
  }

  registerLod(group, (view: LodView) => {
    const counts = levelSegments.map(() => 0);
    let triangles = 0;
    view.camera.getWorldPosition(eye);
    for (const chunk of list) {
      let level = 0;
      if (view.enabled) {
        const distance = Math.max(1e-3, chunk.bounds.clampPoint(eye, closest).distanceTo(eye));
        level = 0;
        for (let l = chunk.errors.length - 1; l > 0; l--) {
          if ((chunk.errors[l] * view.pixelScale) / distance <= options.maxErrorPixels) {
            level = l;
            break;
          }
        }
      }
      chunk.meshes.forEach((mesh, l) => (mesh.visible = l === level));
      counts[level]++;
      triangles += triangleCount(chunk.meshes[level].geometry);
    }
    return { triangles, perLevel: counts };
  });

  return { group, fullDetailTriangles };
}

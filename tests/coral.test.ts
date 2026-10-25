import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRng, hashString, weightedPick } from '../src/core/rng';
import { brainCoral_generate, branchingCoral_generate } from '../src/scenes/coral/reef';

const branching = (seedHash: string): THREE.Mesh =>
  branchingCoral_generate({
    root_pt: new THREE.Vector3(),
    root_normalVec: new THREE.Vector3(0, 1, 0),
    root_distToCeil: 1,
    root_radius: 0.02,
    growthLevelCnt: 3,
    material: new THREE.MeshStandardMaterial(),
    seedHash,
  });

const brain = (seedHash: string): THREE.Mesh =>
  brainCoral_generate({
    root_pt: new THREE.Vector3(),
    root_normalVec: new THREE.Vector3(0, 1, 0),
    material: new THREE.MeshStandardMaterial(),
    x_size: 0.55,
    z_size: 0.6,
    height: 0.3,
    seedHash,
  });

const positions = (mesh: THREE.Mesh): Float32Array => mesh.geometry.getAttribute('position').array as Float32Array;

describe('seed helpers', () => {
  it('hashes names to stable 32-bit seeds', () => {
    expect(hashString('7/coral/brain/1')).toBe(hashString('7/coral/brain/1'));
    expect(hashString('7/coral/brain/1')).not.toBe(hashString('7/coral/brain/2'));
    expect(hashString('')).toBe(0x811c9dc5);
  });

  it('picks in proportion to weight', () => {
    const rng = createRng(1);
    const counts = [0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[weightedPick([0, 1, 2], [1, 3, 0], rng.next)]++;
    expect(counts[2]).toBe(0);
    expect(counts[1] / counts[0]).toBeGreaterThan(2.5);
    expect(counts[1] / counts[0]).toBeLessThan(3.5);
  });
});

describe('coral generators', () => {
  it('builds the same branching coral from the same seed', () => {
    const a = branching('7/coral/branching/0');
    expect(positions(a).length).toBeGreaterThan(0);
    expect(positions(branching('7/coral/branching/0'))).toEqual(positions(a));
    expect(positions(branching('7/coral/branching/1'))).not.toEqual(positions(a));
  });

  it('builds the same brain coral from the same seed', () => {
    const a = brain('7/coral/brain/0');
    expect(Array.from(positions(a)).every(Number.isFinite)).toBe(true);
    expect(positions(brain('7/coral/brain/0'))).toEqual(positions(a));
  });
});

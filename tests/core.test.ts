import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { InstancedLod, lodUpdaters } from '../src/core/lod';
import { lookAtPose } from '../src/core/pose';
import { createRng, createValueNoise2D } from '../src/core/rng';
import { SimClock } from '../src/core/simClock';
import { createTerrainLod } from '../src/core/terrainLod';
import { patchUnderwater } from '../src/core/water';
import { computeWaterCoefficients, formImage, transmittance } from '../src/core/waterModel';

describe('rng', () => {
  it('is reproducible for a seed and differs across seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
    seqA.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    seqA.forEach((v) => expect(v).toBeLessThan(1));
  });

  it('noise is deterministic and bounded', () => {
    const n1 = createValueNoise2D(3);
    const n2 = createValueNoise2D(3);
    for (let i = 0; i < 50; i++) {
      const v = n1(i * 0.37, i * -0.21);
      expect(v).toBe(n2(i * 0.37, i * -0.21));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});

describe('water model', () => {
  it('transmittance is 1 at zero range and decays per channel', () => {
    expect(transmittance([0.4, 0.1, 0.05], 0)).toEqual([1, 1, 1]);
    const t = transmittance([0.4, 0.1, 0.05], 10);
    expect(t[0]).toBeLessThan(t[1]);
    expect(t[1]).toBeLessThan(t[2]);
  });

  it('image tends to the veiling light at long range and to J at zero range', () => {
    const c = computeWaterCoefficients({ turbidity: 0.3, depth: 10 });
    const j = [0.8, 0.5, 0.3] as const;
    expect(formImage(j, 0, c)).toEqual([...j]);
    const far = formImage(j, 1e4, c);
    far.forEach((v, i) => expect(v).toBeCloseTo(c.bInf[i], 6));
  });

  it('turbidity increases attenuation and depth reduces ambient light', () => {
    const clear = computeWaterCoefficients({ turbidity: 0, depth: 5 });
    const murky = computeWaterCoefficients({ turbidity: 1, depth: 5 });
    const deep = computeWaterCoefficients({ turbidity: 0, depth: 40 });
    murky.betaD.forEach((v, i) => expect(v).toBeGreaterThan(clear.betaD[i]));
    deep.ambient.forEach((v, i) => expect(v).toBeLessThan(clear.ambient[i]));
    // Red is absorbed first.
    expect(deep.ambient[0]).toBeLessThan(deep.ambient[2]);
  });
});

describe('water shader patch', () => {
  it('injects image formation into a standard material', () => {
    const material = patchUnderwater(new THREE.MeshStandardMaterial());
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vWaterView = mvPosition.xyz;');
    expect(shader.fragmentShader).toContain('applyWater( gl_FragColor.rgb, vWaterView )');
    expect(shader.uniforms.uWaterBetaD).toBeDefined();
  });
});

describe('sim clock', () => {
  it('stops advancing while paused and caps large deltas', () => {
    const clock = new SimClock();
    expect(clock.tick(0.05)).toBeCloseTo(0.05);
    clock.setPaused(true);
    expect(clock.tick(0.05)).toBe(0);
    clock.setPaused(false);
    expect(clock.tick(5)).toBeCloseTo(0.1);
    expect(clock.now).toBeCloseTo(0.15);
  });
});

describe('pose', () => {
  it('orients the camera toward the target (-z forward)', () => {
    const pose = lookAtPose(new THREE.Vector3(1, 2, 3), new THREE.Vector3(1, 2, -7));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().fromArray(pose.quaternion));
    expect(forward.z).toBeCloseTo(-1);
    expect(pose.position).toEqual([1, 2, 3]);
  });
});

describe('level of detail', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld();
  const ball = (detail: number): THREE.BufferGeometry => new THREE.IcosahedronGeometry(1, detail);
  const at = (z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(0, 0, z);

  it('picks coarser levels for instances that look smaller and culls those behind the camera', () => {
    const lod = new InstancedLod(
      'test',
      [
        { geometry: ball(2), minPixels: 20 },
        { geometry: ball(1), minPixels: 5 },
        { geometry: ball(0), minPixels: 0.75 },
      ],
      new THREE.MeshBasicMaterial(),
      [at(-500), at(-5), at(-50), at(5)],
    );
    lod.update({ camera, pixelScale: 600 });
    // -5 m: 150 px, -50 m: 12 px, -500 m: 1.2 px, +5 m is behind the camera.
    expect(lod.meshes.map((m) => m.count)).toEqual([1, 1, 1]);
    lod.update(null);
    expect(lod.meshes.map((m) => m.count)).toEqual([4, 0, 0]);
  });

  it('coarsens flat terrain chunks and keeps bumpy ones fine up close', () => {
    const build = (heightAt: (x: number, z: number) => number): THREE.Group =>
      createTerrainLod({
        name: 'ground',
        size: 40,
        heightAt,
        colorAt: (_x, _z, c) => c.set(0xffffff),
        material: new THREE.MeshBasicMaterial(),
        chunks: 2,
        levelSegments: [16, 4],
        maxErrorPixels: 1.5,
      });
    const view = { camera, pixelScale: 600 };
    const levels = (group: THREE.Group): number[] =>
      group.children.filter((c) => c.visible).map((c) => Number(c.name.slice(-1)));
    const flatGround = build(() => -2);
    lodUpdaters(flatGround).forEach((u) => u(view));
    expect(levels(flatGround)).toEqual([1, 1, 1, 1]);
    const bumpy = build((x, z) => -2 + 0.5 * Math.sin(x * 2) * Math.cos(z * 2));
    lodUpdaters(bumpy).forEach((u) => u(view));
    expect(levels(bumpy)).toEqual([0, 0, 0, 0]);
  });
});

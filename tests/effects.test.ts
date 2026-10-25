import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LabelPasses } from '../src/core/labelPasses';
import { InstancedLod, lodUpdaters } from '../src/core/lod';
import { RobotTrack, TRACK_INTERVAL, TRACK_WINDOW, yawOf, type TrackSample } from '../src/core/robotTrack';
import { emission, PUFF_LIFE, puffAt } from '../src/core/sediment';
import { createTerrainLod } from '../src/core/terrainLod';
import { coverageAgreement, imageDifference, labelAgreement, median, quantile, rmsContrast } from '../src/eval/metrics';
import { reportToCsv } from '../src/eval/runner';

const flat = (): number => 0;
const still = new THREE.Vector3();

function sample(altitude: number, speed: number, t = 0): TrackSample {
  return { t, position: new THREE.Vector3(0, altitude, 0), velocity: new THREE.Vector3(speed, 0, 0), yaw: 0, altitude };
}

describe('robot track', () => {
  it('samples on a fixed grid and derives velocity', () => {
    const track = new RobotTrack();
    for (let t = 0; t <= 2; t += 1 / 60) track.record(t, new THREE.Vector3(t * 0.5, -10, 0), 0, () => -12);
    const times = track.all.map((s) => s.t);
    times.forEach((t) => expect(Math.abs(t / TRACK_INTERVAL - Math.round(t / TRACK_INTERVAL))).toBeLessThan(1e-6));
    expect(track.all.at(-1)!.velocity.x).toBeCloseTo(0.5, 1);
    expect(track.all.at(-1)!.altitude).toBeCloseTo(2);
  });

  it('restarts when time goes backwards and drops samples older than the window', () => {
    const track = new RobotTrack();
    for (let t = 0; t <= TRACK_WINDOW + 5; t += 0.05) track.record(t, still, 0, flat);
    expect(track.all[0].t).toBeGreaterThanOrEqual(5 - 1e-6);
    track.record(1, still, 0, flat);
    expect(track.all).toHaveLength(1);
  });

  it('rebuilds the same history whatever the frame spacing', () => {
    const poseAt = (t: number): { position: THREE.Vector3; yaw: number } => ({ position: new THREE.Vector3(t, -5, 0), yaw: 0 });
    const a = new RobotTrack();
    const b = new RobotTrack();
    a.rebuild(12.3, poseAt, flat);
    b.rebuild(12.39, poseAt, flat);
    expect(a.all.map((s) => s.t)).toEqual(b.all.map((s) => s.t));
    expect(a.all.at(-1)!.velocity.x).toBeCloseTo(1);
  });

  it('reads yaw back from a camera orientation', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
    expect(yawOf(q)).toBeCloseTo(0.7);
  });
});

describe('kicked-up sediment', () => {
  it('only lifts sediment when flying low, more when moving', () => {
    expect(emission(sample(3, 0.5), 1)).toBe(0);
    const hovering = emission(sample(0.9, 0), 1);
    const moving = emission(sample(0.9, 0.6), 1);
    expect(hovering).toBeGreaterThan(0);
    expect(moving).toBeGreaterThan(hovering);
    expect(emission(sample(0.9, 0.6), 0)).toBe(0);
  });

  it('puffs grow, drift with the current and vanish after their lifetime', () => {
    const s = sample(0.8, 0.5);
    const current = new THREE.Vector3(0.1, 0, 0);
    const early = puffAt(s, 1, 1, 1, current, flat)!;
    const late = puffAt(s, 1, 10, 1, current, flat)!;
    expect(late.radius).toBeGreaterThan(early.radius);
    expect(late.center.x - early.center.x).toBeGreaterThan(0.5);
    expect(late.center.y).toBeGreaterThanOrEqual(0);
    expect(puffAt(s, 1, PUFF_LIFE + 1, 1, current, flat)).toBeNull();
    expect(puffAt(s, 1, -1, 1, current, flat)).toBeNull();
  });

  it('is deterministic for a given sample', () => {
    const s = sample(0.8, 0.5, 4.2);
    expect(puffAt(s, -1, 9, 1, still, flat)).toEqual(puffAt(s, -1, 9, 1, still, flat));
  });
});

describe('level of detail', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld();
  const box = (detail: number): THREE.BufferGeometry => new THREE.IcosahedronGeometry(1, detail);
  const at = (z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(0, 0, z);

  it('picks coarser levels for instances that look smaller and keeps label indices stable', () => {
    const lod = new InstancedLod(
      'test',
      [
        { geometry: box(2), minPixels: 20 },
        { geometry: box(1), minPixels: 5 },
        { geometry: box(0), minPixels: 0.75 },
      ],
      new THREE.MeshBasicMaterial(),
      [at(-500), at(-5), at(-50), at(5)],
    );
    const stats = lod.update({ camera, pixelScale: 600, enabled: true });
    // -5 m: 150 px, -50 m: 12 px, -500 m: 1.2 px, +5 m is behind the camera.
    expect(stats.perLevel).toEqual([1, 1, 1]);
    const labels = lod.meshes.map((mesh) => (mesh.geometry.getAttribute('labelIndex') as THREE.BufferAttribute).getX(0));
    expect(labels).toEqual([1, 2, 0]);
    expect(lod.update({ camera, pixelScale: 600, enabled: false }).perLevel).toEqual([4, 0, 0]);
  });

  it('gives every LOD level of an object the same label instance ids', () => {
    const lod = new InstancedLod('rocks', [{ geometry: box(1), minPixels: 5 }, { geometry: box(0), minPixels: 0 }], new THREE.MeshBasicMaterial(), [at(-5), at(-9)]);
    const root = new THREE.Group().add(new THREE.Mesh(box(0)), lod.group);
    const records = new LabelPasses().prepare(root, []);
    expect(records.map((r) => r.count)).toEqual([1, 2]);
    expect(lod.meshes.map((m) => m.userData.instanceBase)).toEqual([2, 2]);
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
      }).group;
    const view = { camera, pixelScale: 600, enabled: true };
    const levels = (group: THREE.Group): number[] => group.children.filter((c) => c.visible).map((c) => Number(c.name.slice(-1)));
    const flatGround = build(() => -2);
    lodUpdaters(flatGround).forEach((u) => u(view));
    expect(levels(flatGround)).toEqual([1, 1, 1, 1]);
    const bumpy = build((x, z) => -2 + 0.5 * Math.sin(x * 2) * Math.cos(z * 2));
    lodUpdaters(bumpy).forEach((u) => u(view));
    expect(levels(bumpy)).toEqual([0, 0, 0, 0]);
  });
});

describe('evaluation metrics', () => {
  const image = (values: number[][]): Uint8Array => new Uint8Array(values.flatMap(([r, g, b]) => [r, g, b, 255]));

  it('measures image differences', () => {
    const a = image([[0, 0, 0], [100, 100, 100]]);
    expect(imageDifference(a, a)).toEqual({ meanAbs: 0, psnr: Infinity, changed: 0 });
    const b = image([[0, 0, 0], [130, 100, 100]]);
    const d = imageDifference(a, b);
    expect(d.meanAbs).toBeCloseTo(5);
    expect(d.changed).toBe(0.5);
    expect(d.psnr).toBeCloseTo(10 * Math.log10((255 * 255) / 150));
    expect(() => imageDifference(a, image([[0, 0, 0]]))).toThrow();
  });

  it('checks depth/mask coverage and label agreement', () => {
    const mask = image([[3, 0, 1], [0, 0, 0]]);
    expect(coverageAgreement(new Float32Array([2.5, 0]), mask)).toBe(1);
    expect(coverageAgreement(new Float32Array([2.5, 4]), mask)).toBe(0.5);
    expect(labelAgreement(mask, image([[3, 0, 2], [0, 0, 0]]))).toBe(0.5);
  });

  it('computes contrast and quantiles', () => {
    expect(rmsContrast(image([[128, 128, 128], [128, 128, 128]]))).toBe(0);
    expect(rmsContrast(image([[0, 0, 0], [255, 255, 255]]))).toBeCloseTo(0.5);
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2.5);
    expect(median([5])).toBe(5);
  });

  it('writes one CSV row per variant', () => {
    const variant = {
      id: 'reference',
      label: 'All effects, "on"',
      frameMs: { median: 1, p95: 2 },
      savedMs: 0,
      triangles: 10,
      drawCalls: 2,
      lodTriangles: 8,
      image: { meanAbs: 0, psnr: 99, changed: 0 },
      contrast: 0.2,
      coverage: 1,
      labelAgreement: 1,
    };
    const csv = reportToCsv({ scene: 's', seed: 1, trajectory: 't', width: 2, height: 2, frames: 1, repeats: 1, renderer: 'r', date: '', variants: [variant] });
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"All effects, ""on"""');
  });
});

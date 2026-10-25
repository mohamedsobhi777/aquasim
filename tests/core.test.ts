import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { glToCvCameraToWorld, intrinsicsFromVerticalFov } from '../src/core/cameraModel';
import { encodeNpyFloat32, extractChannel, flipRows } from '../src/core/encoders';
import { percentile } from '../src/core/frameStats';
import { createRng, createValueNoise2D } from '../src/core/rng';
import { decodeLabel, encodeLabel, validateClasses } from '../src/core/semantics';
import { SimClock } from '../src/core/simClock';
import { duration, lookAtTrajectory, samplePose } from '../src/core/trajectory';
import { computeWaterCoefficients, formImage, transmittance } from '../src/core/waterModel';
import { patchUnderwater } from '../src/core/water';
import { cylinderBetween, restPipeOnGround } from '../src/scenes/infrastructure/geometry';

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
    const c = computeWaterCoefficients({ presetId: 'coastal', turbidity: 0.3, depth: 10 });
    const j = [0.8, 0.5, 0.3] as const;
    expect(formImage(j, 0, c)).toEqual([...j]);
    const far = formImage(j, 1e4, c);
    far.forEach((v, i) => expect(v).toBeCloseTo(c.bInf[i], 6));
  });

  it('turbidity increases attenuation and depth reduces ambient light', () => {
    const clear = computeWaterCoefficients({ presetId: 'clear-ocean', turbidity: 0, depth: 5 });
    const murky = computeWaterCoefficients({ presetId: 'clear-ocean', turbidity: 1, depth: 5 });
    const deep = computeWaterCoefficients({ presetId: 'clear-ocean', turbidity: 0, depth: 40 });
    murky.betaD.forEach((v, i) => expect(v).toBeGreaterThan(clear.betaD[i]));
    deep.ambient.forEach((v, i) => expect(v).toBeLessThan(clear.ambient[i]));
    // Red is absorbed first.
    expect(deep.ambient[0]).toBeLessThan(deep.ambient[2]);
  });

  it('rejects unknown presets', () => {
    expect(() => computeWaterCoefficients({ presetId: 'nope', turbidity: 0, depth: 0 })).toThrow(/Unknown water preset/);
  });
});

describe('water shader patch', () => {
  it('injects image formation and lamp-path attenuation into a standard material', () => {
    const material = patchUnderwater(new THREE.MeshStandardMaterial());
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vWaterView = mvPosition.xyz;');
    expect(shader.fragmentShader).toContain('applyWater( gl_FragColor.rgb, vWaterView )');
    expect(shader.fragmentShader).toContain('exp( -uWaterBetaD * lightDistance * uWaterEnabled )');
    expect(shader.fragmentShader).not.toContain('#include <lights_pars_begin>');
    expect(shader.uniforms.uWaterBetaD).toBeDefined();
  });
});

describe('semantics', () => {
  it('round-trips class and 16-bit instance ids', () => {
    const [r, g, b] = encodeLabel(7, 0x1234);
    expect([r, g, b]).toEqual([7, 0x12, 0x34]);
    expect(decodeLabel(r, g, b)).toEqual({ classId: 7, instanceId: 0x1234 });
    expect(() => encodeLabel(256, 0)).toThrow();
    expect(() => encodeLabel(1, 70000)).toThrow();
  });

  it('validates class ids', () => {
    expect(() => validateClasses([{ id: 0, name: 'x', color: [0, 0, 0] }])).toThrow(/invalid id/);
    expect(() =>
      validateClasses([
        { id: 1, name: 'a', color: [0, 0, 0] },
        { id: 1, name: 'b', color: [0, 0, 0] },
      ]),
    ).toThrow(/Duplicate/);
  });
});

describe('camera model', () => {
  it('computes OpenCV intrinsics from a vertical fov', () => {
    const k = intrinsicsFromVerticalFov(90, 640, 480);
    expect(k.fy).toBeCloseTo(240);
    expect(k.fx).toBeCloseTo(240);
    expect([k.cx, k.cy]).toEqual([320, 240]);
  });

  it('a GL camera at the origin looking down -z maps to an OpenCV camera looking +z flipped', () => {
    const cv = glToCvCameraToWorld(new THREE.Matrix4().identity().toArray());
    const m = new THREE.Matrix4().fromArray(cv);
    // OpenCV forward (+z in camera) should point to world -z.
    expect(new THREE.Vector3(0, 0, 1).transformDirection(m).z).toBeCloseTo(-1);
    expect(new THREE.Vector3(0, 1, 0).transformDirection(m).y).toBeCloseTo(-1);
  });
});

describe('encoders', () => {
  it('flips rows', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect([...flipRows(data, 1, 3, 2)]).toEqual([5, 6, 3, 4, 1, 2]);
  });

  it('extracts a channel', () => {
    expect([...extractChannel(new Float32Array([1, 9, 2, 9]), 2, 0)]).toEqual([1, 2]);
  });

  it('writes a valid npy header with 64-byte aligned data', () => {
    const bytes = encodeNpyFloat32(new Float32Array([1.5, -2, 3, 4, 5, 6]), [2, 3]);
    expect([...bytes.slice(0, 6)]).toEqual([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]);
    const headerLength = bytes[8] | (bytes[9] << 8);
    const header = new TextDecoder().decode(bytes.slice(10, 10 + headerLength));
    expect(header).toContain("'shape': (2, 3)");
    expect(header.endsWith('\n')).toBe(true);
    expect((10 + headerLength) % 64).toBe(0);
    const values = new Float32Array(bytes.slice(10 + headerLength).buffer);
    expect([...values]).toEqual([1.5, -2, 3, 4, 5, 6]);
    expect(() => encodeNpyFloat32(new Float32Array(3), [2, 2])).toThrow();
  });
});

describe('frame stats', () => {
  it('computes nearest-rank percentiles', () => {
    const v = [5, 1, 4, 2, 3];
    expect(percentile(v, 50)).toBe(3);
    expect(percentile(v, 100)).toBe(5);
    expect(percentile([], 95)).toBe(0);
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

describe('trajectory', () => {
  const eye = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)];
  const target = [new THREE.Vector3(0, 0, -5), new THREE.Vector3(10, 0, -5)];
  const trajectory = lookAtTrajectory('line', eye, target, 2);

  it('moves at the requested speed', () => {
    expect(duration(trajectory)).toBeCloseTo(5);
    expect(samplePose(trajectory, 2.5).position[0]).toBeCloseTo(5);
  });

  it('orients the camera toward the target (-z forward)', () => {
    const q = new THREE.Quaternion().fromArray(samplePose(trajectory, 1).quaternion);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    expect(forward.z).toBeCloseTo(-1);
  });

  it('clamps outside the time range and rejects bad input', () => {
    expect(samplePose(trajectory, -1)).toBe(trajectory.poses[0]);
    expect(samplePose(trajectory, 99)).toBe(trajectory.poses[1]);
    expect(() => lookAtTrajectory('x', eye, target, 0)).toThrow();
    expect(() => samplePose({ name: 'empty', poses: [] }, 0)).toThrow(/empty/);
  });
});

describe('infrastructure geometry', () => {
  it('rests a pipe on the ground and bridges a narrow dip (free span)', () => {
    const ground = Array.from({ length: 60 }, (_, i) => (i >= 28 && i <= 32 ? -1 : 0));
    const y = restPipeOnGround(ground, 0.4);
    y.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(ground[i] + 0.4 - 1e-9));
    // In the dip the pipe stays well above the dip floor.
    expect(y[30] - (ground[30] + 0.4)).toBeGreaterThan(0.5);
    // Far from the dip it rests on the ground.
    expect(y[5]).toBeCloseTo(0.4);
  });

  it('builds a unit-cylinder transform spanning two points', () => {
    const a = new THREE.Vector3(0, 0, 0);
    const b = new THREE.Vector3(0, 0, 4);
    const m = cylinderBetween(a, b, 0.5);
    const top = new THREE.Vector3(0, 0.5, 0).applyMatrix4(m);
    const bottom = new THREE.Vector3(0, -0.5, 0).applyMatrix4(m);
    expect(top.distanceTo(b) < 1e-6 || top.distanceTo(a) < 1e-6).toBe(true);
    expect(top.distanceTo(bottom)).toBeCloseTo(4);
    expect(() => cylinderBetween(a, a, 1)).toThrow();
  });
});

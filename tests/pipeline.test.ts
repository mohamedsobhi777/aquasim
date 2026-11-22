import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createValueNoise2D } from '../src/core/rng';
import { createPipeline } from '../src/scenes/pipeSite/pipeline';

it.each([0, 7, 9999])('keeps the pipe and its replay clear over terrain (seed %i)', (seed) => {
  const noise = createValueNoise2D(seed);
  const ground = (x: number, z: number) => -20 + 2 * noise(x * 0.08, z * 0.08);
  const { group, route, allowsRock } = createPipeline(ground);
  const flange = group.getObjectByName('flange')!;
  expect(group.children.filter((part) => part.userData.semanticClass === 'pipe')).toHaveLength(2);
  for (let t = 0; t <= route.duration; t += 0.25) {
    const [x, y, z] = route.poseAt(t).position;
    expect(y - ground(x, z)).toBeGreaterThanOrEqual(1);
    expect(allowsRock(x, z, 0.5)).toBe(false);
  }
  for (let x = -12; x <= 10; x += 0.25) {
    expect(flange.position.y - 0.68).toBeGreaterThan(ground(x, 0));
    expect(allowsRock(x, 0, 1)).toBe(false);
  }
  expect(allowsRock(50, 50, 3)).toBe(true);
  expect(route.poseAt(0)).toEqual(route.poseAt(-1));
  const closeup = route.poseAt(route.duration);
  expect(route.poseAt(100)).toEqual(closeup);
  const target = flange.position.clone();
  target.x = 0;
  const direction = target.sub(new THREE.Vector3(...closeup.position)).normalize();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...closeup.quaternion));
  expect(forward.dot(direction)).toBeCloseTo(1);
});

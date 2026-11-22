import * as THREE from 'three';
import { expect, it } from 'vitest';
import { Rov } from '../src/core/rov';

it('keeps both headlights and their targets in the piloted camera frame', () => {
  const { body: camera, lamps: lights } = new Rov();
  camera.position.set(1, -12, 5);
  camera.rotation.set(0.3, 1.7, 0);
  camera.updateMatrixWorld(true);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  expect(lights[0].position.x).toBeLessThan(0);
  expect(lights[1].position.x).toBeGreaterThan(0);
  for (const lamp of lights) {
    const aim = lamp.target.getWorldPosition(new THREE.Vector3()).sub(lamp.getWorldPosition(new THREE.Vector3()));
    expect(aim.normalize().dot(forward)).toBeGreaterThan(0.99);
    expect(lamp.castShadow).toBe(true);
  }
});

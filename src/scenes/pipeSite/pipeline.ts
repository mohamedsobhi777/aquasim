import * as THREE from 'three';
import { tagSemantic } from '../../core/semantics';
import { CLASSES } from '../infrastructure/layout';
import { lookAtPose } from '../../core/pose';
import { patchUnderwater } from '../../core/water';

const START = -12;
const JOINT = 0;
const END = 10;
const RADIUS = 0.42;
const ROUTE_OFFSET = 5;

export function createPipeline(heightAt: (x: number, z: number) => number) {
  const group = new THREE.Group();
  group.name = 'inspection-pipeline';

  // Lay two straight spools on one axis above the highest part of the pipe bed.
  let bed = -Infinity;
  for (let x = START; x <= END; x += 0.5) bed = Math.max(bed, heightAt(x, 0));
  const axisY = bed + 1.4;
  const axis = (x: number) => new THREE.Vector3(x, axisY, 0);
  const material = (color: number) => patchUnderwater(new THREE.MeshStandardMaterial({ color, roughness: 0.72 }));
  const coating = material(0xcaa34c);
  const steel = material(0x758890);
  const bolts = material(0x3d474c);
  const concrete = material(0x998e78);

  function add(
    geometry: THREE.BufferGeometry,
    surface: THREE.Material,
    kind: 'pipe' | 'joint' | 'support',
    name: string,
  ) {
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.name = name;
    mesh.userData.semanticClass = kind;
    tagSemantic(mesh, { pipe: CLASSES.pipeline, joint: CLASSES.fieldJoint, support: CLASSES.pipeSupport }[kind].id);
    group.add(mesh);
    return mesh;
  }

  for (const [start, end] of [
    [START, JOINT],
    [JOINT, END],
  ]) {
    const span = add(new THREE.CylinderGeometry(RADIUS, RADIUS, end - start, 32), coating, 'pipe', 'pipe-' + start);
    span.rotation.z = -Math.PI / 2;
    span.position.copy(axis((start + end) / 2));
    for (const fraction of [0.22, 0.78]) {
      const x = THREE.MathUtils.lerp(start, end, fraction);
      // Embed the footing slightly so its edges meet uneven terrain.
      const bottom = heightAt(x, 0) - 0.25;
      const top = axisY - 0.29;
      const support = add(new THREE.BoxGeometry(0.7, top - bottom, 1.35), concrete, 'support', 'pipe-support');
      support.position.set(x, (top + bottom) / 2, 0);
    }
  }

  for (const offset of [-0.1, 0.1]) {
    const flange = add(new THREE.CylinderGeometry(0.68, 0.68, 0.16, 32), steel, 'joint', 'flange');
    flange.rotation.z = -Math.PI / 2;
    flange.position.copy(axis(JOINT + offset));
  }
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const bolt = add(new THREE.CylinderGeometry(0.064, 0.064, 0.44, 6), bolts, 'joint', 'flange-bolt');
    bolt.rotation.z = -Math.PI / 2;
    bolt.position.set(JOINT, axisY + 0.55 * Math.cos(angle), 0.55 * Math.sin(angle));
  }

  const route = {
    duration: 10,
    poseAt(seconds: number) {
      const t = THREE.MathUtils.smoothstep(seconds, 0, this.duration);
      const eye = axis(THREE.MathUtils.lerp(START, JOINT - 1.4, t));
      eye.z = THREE.MathUtils.lerp(ROUTE_OFFSET, 2.3, t);
      eye.y = Math.max(axisY + 1.2 - 0.6 * t, heightAt(eye.x, eye.z) + 1.1);
      const target = axis(Math.min(JOINT, eye.x + 6));
      return lookAtPose(eye, target);
    },
  };
  // Keep the pipe, the camera track, and the sight lines between them clear.
  function allowsRock(x: number, z: number, radius: number): boolean {
    const dx = Math.max(START - x, 0, x - END);
    const dz = Math.max(-z, 0, z - ROUTE_OFFSET);
    return Math.hypot(dx, dz) > radius + 1;
  }
  return { group, route, allowsRock };
}

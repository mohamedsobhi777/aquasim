import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tagSemantic } from '../../core/semantics';
import { CLASSES } from '../infrastructure/layout';
import { lookAtPose } from '../../core/pose';
import { patchUnderwater } from '../../core/water';

import { makeRustMap } from './rust';
import { pipeSupportGeometry } from './support';

const START = -12;
const JOINT = 0;
const END = 10;
const RADIUS = 0.42;
const ROUTE_OFFSET = 5;

export function createPipeline(heightAt: (x: number, z: number) => number, coatingMap?: THREE.Texture, seed = 0) {
  const group = new THREE.Group();
  group.name = 'inspection-pipeline';

  // Lay two straight spools on one axis above the highest part of the pipe bed.
  let bed = -Infinity;
  for (let x = START; x <= END; x += 0.5) bed = Math.max(bed, heightAt(x, 0));
  const axisY = bed + 1.4;
  const axis = (x: number) => new THREE.Vector3(x, axisY, 0);
  const coating = patchUnderwater(
    new THREE.MeshStandardMaterial({
      color: coatingMap ? 0xffffff : 0xc29a50,
      map: coatingMap ?? null,
      roughness: 0.89,
    }),
  );
  const rust = makeRustMap(seed);
  const steel = patchUnderwater(
    new THREE.MeshStandardMaterial({ color: 0x959286, map: rust, roughness: 0.64, metalness: 0.38 }),
  );
  const bolts = patchUnderwater(
    new THREE.MeshStandardMaterial({ color: 0x827768, map: rust, roughness: 0.57, metalness: 0.45 }),
  );
  const supportMaterial = patchUnderwater(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }));

  const supportSteel = patchUnderwater(
    new THREE.MeshStandardMaterial({ vertexColors: true, map: rust, roughness: 0.78, metalness: 0.2 }),
  );
  function add(
    geometry: THREE.BufferGeometry,
    surface: THREE.Material | THREE.Material[],
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
      const ground = [-0.55, 0, 0.55].flatMap((dx) => [-0.96, 0, 0.96].map((z) => heightAt(x + dx, z) - axisY));
      const bottom = Math.min(...ground) - 0.2;
      const footingTop = Math.min(Math.max(...ground) + 0.22, -RADIUS - 0.25);
      const support = add(
        pipeSupportGeometry(RADIUS, bottom, footingTop),
        [supportMaterial, supportSteel],
        'support',
        'pipe-support',
      );
      support.position.copy(axis(x));
    }
  }

  // Each radial profile runs from the gasket face to the tapered weld neck.
  const profile = [
    [0.41, 0.02],
    [0.665, 0.02],
    [0.68, 0.035],
    [0.68, 0.158],
    [0.665, 0.175],
    [0.505, 0.175],
    [0.475, 0.205],
    [0.438, 0.34],
    [0.421, 0.355],
  ];
  const flangeGeometry = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    64,
  );
  for (const side of [-1, 1]) {
    const flange = add(flangeGeometry, steel, 'joint', 'flange');
    flange.rotation.z = (-side * Math.PI) / 2;
    flange.position.copy(axis(JOINT));
  }
  // Model each fastener as one labelled object, including its head, nut and exposed stud.
  const fastenerParts = [
    new THREE.CylinderGeometry(0.039, 0.039, 0.495, 12),
    new THREE.CylinderGeometry(0.072, 0.072, 0.052, 6).translate(0, -0.208, 0),
    new THREE.CylinderGeometry(0.072, 0.072, 0.052, 6).translate(0, 0.208, 0),
    ...[-1, 1].map((side) => new THREE.CylinderGeometry(0.08, 0.08, 0.009, 24).translate(0, side * 0.1795, 0)),
  ];
  const fastener = mergeGeometries(fastenerParts);
  fastenerParts.forEach((part) => part.dispose());
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const bolt = add(fastener, bolts, 'joint', 'flange-bolt');
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

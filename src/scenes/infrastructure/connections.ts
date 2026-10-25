import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { tagSemantic } from '../../core/semantics';
import { patchUnderwater } from '../../core/water';
import { collarAt, cylinderBetween, instanced } from './geometry';
import { legOutward, legPoint } from './jacket';
import { CLASSES, PIPE, SEABED_Y } from './layout';
import { merge, placed, valveGeometry, type SubseaTemplate } from './template';

type HeightFn = (x: number, z: number) => number;

const UMBILICAL_RADIUS = 0.09;
/** Jacket leg that carries the umbilical J-tube. */
const J_TUBE_LEG = 3;
const J_TUBE_STANDOFF = 1.3;
const J_TUBE_TOP = SEABED_Y + 14;
const HUB_HEIGHT = 1.4;
const MATTRESS_ALONG = 7;
const MATTRESS_ACROSS = 5;
const UP = new THREE.Vector3(0, 1, 0);

export interface Connections {
  group: THREE.Group;
  umbilical: THREE.CatmullRomCurve3;
  plet: THREE.Vector3;
  /** Horizontal unit direction of the pipeline at the PLET. */
  pletTangent: THREE.Vector3;
}

function closestParameter(curve: THREE.Curve<THREE.Vector3>, x: number, z: number): number {
  let best = 0;
  let bestDistance = Infinity;
  const samples = 600;
  for (let i = 0; i <= samples; i++) {
    const p = curve.getPointAt(i / samples);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestDistance) {
      bestDistance = d;
      best = i / samples;
    }
  }
  return best;
}

function jTubePoint(y: number): THREE.Vector3 {
  return legPoint(J_TUBE_LEG, y).addScaledVector(legOutward(J_TUBE_LEG), J_TUBE_STANDOFF);
}

/**
 * Concrete mattress: a grid of blocks draped over the seabed and over a line
 * (pipe or umbilical) running along its centre.
 */
function mattressGeometry(center: THREE.Vector3, tangent: THREE.Vector3, heightAt: HeightFn, bumpHeight: number, bumpHalfWidth: number): THREE.BufferGeometry {
  const along = tangent.clone().setY(0).normalize();
  const across = new THREE.Vector3().crossVectors(along, UP).normalize();
  const yaw = Math.atan2(along.x, along.z);
  const blocks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < MATTRESS_ALONG; i++) {
    for (let j = 0; j < MATTRESS_ACROSS; j++) {
      const a = (i - (MATTRESS_ALONG - 1) / 2) * 0.5;
      const c = (j - (MATTRESS_ACROSS - 1) / 2) * 0.5;
      const p = center.clone().addScaledVector(along, a).addScaledVector(across, c);
      const drape = bumpHeight * Math.max(0, 1 - (Math.abs(c) / bumpHalfWidth) ** 2);
      p.y = heightAt(p.x, p.z) + 0.11 + drape;
      blocks.push(placed(new THREE.BoxGeometry(0.44, 0.22, 0.42), p, new THREE.Euler(0, yaw, 0)));
    }
  }
  return merge(blocks);
}

export function createConnections(rng: Rng, heightAt: HeightFn, pipeline: THREE.Curve<THREE.Vector3>, template: SubseaTemplate): Connections {
  const group = new THREE.Group();
  group.name = 'subsea-connections';
  const steel = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x5e6460, roughness: 0.6, metalness: 0.4 }));
  const darkSteel = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x3c4245, roughness: 0.5, metalness: 0.5 }));
  const yellow = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xc89a22, roughness: 0.7 }));
  const umbilicalMaterial = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xd9861c, roughness: 0.55 }));
  const concrete = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x8e8a7e, roughness: 1 }));
  const meshes: THREE.Mesh[] = [];

  // PLET on the pipeline, at the point closest to the template's export hub.
  const hubXZ = template.jumperHub;
  const u = closestParameter(pipeline, hubXZ.x, hubXZ.z);
  const pipePoint = pipeline.getPointAt(u);
  const pipeTangent = pipeline.getTangentAt(u);
  const yaw = Math.atan2(pipeTangent.x, pipeTangent.z);
  const groundBelow = heightAt(pipePoint.x, pipePoint.z) - pipePoint.y;
  const plet = new THREE.Mesh(
    merge([
      placed(new THREE.BoxGeometry(3.2, 0.3, 5.5), new THREE.Vector3(0, groundBelow + 0.15, 0)),
      placed(new THREE.BoxGeometry(2.2, -groundBelow, 0.5), new THREE.Vector3(0, groundBelow / 2, 2.2)),
      placed(new THREE.BoxGeometry(2.2, -groundBelow, 0.5), new THREE.Vector3(0, groundBelow / 2, -2.2)),
      placed(new THREE.BoxGeometry(1.1, 1.1, 1.4), new THREE.Vector3(0, 0, 0)),
      placed(new THREE.CylinderGeometry(0.24, 0.24, HUB_HEIGHT, 16), new THREE.Vector3(0, HUB_HEIGHT / 2, 0)),
      placed(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 20), new THREE.Vector3(0, HUB_HEIGHT, 0)),
    ]),
    yellow,
  );
  plet.name = 'plet';
  plet.position.copy(pipePoint);
  plet.rotation.y = yaw;
  tagSemantic(plet, CLASSES.plet.id);
  meshes.push(plet);

  const pletValve = new THREE.Mesh(valveGeometry(), darkSteel);
  pletValve.name = 'plet-valve';
  pletValve.position.copy(pipePoint).add(new THREE.Vector3(0, 0.75, 0));
  pletValve.rotation.y = yaw + Math.PI / 2;
  pletValve.scale.setScalar(0.8);
  tagSemantic(pletValve, CLASSES.valve.id);
  meshes.push(pletValve);

  // Rigid M-shaped jumper between the manifold export hub and the PLET hub.
  const a = template.jumperHub;
  const b = pipePoint.clone().add(new THREE.Vector3(0, HUB_HEIGHT + 0.15, 0));
  const top = Math.max(a.y, b.y) + 2.6;
  const jumperCurve = new THREE.CatmullRomCurve3(
    [
      a,
      a.clone().add(new THREE.Vector3(0, 0, -1.2)),
      new THREE.Vector3(a.x, top - 0.4, THREE.MathUtils.lerp(a.z, b.z, 0.3)),
      new THREE.Vector3((a.x + b.x) / 2, top, (a.z + b.z) / 2),
      new THREE.Vector3(b.x, top - 0.4, THREE.MathUtils.lerp(a.z, b.z, 0.75)),
      b.clone().add(new THREE.Vector3(0, 1.2, 0)),
      b,
    ],
    false,
    'centripetal',
  );
  const jumper = new THREE.Mesh(new THREE.TubeGeometry(jumperCurve, 120, 0.2, 14, false), steel);
  jumper.name = 'jumper';
  tagSemantic(jumper, CLASSES.jumper.id);
  meshes.push(jumper);
  const connectors = instanced(
    new THREE.CylinderGeometry(1, 1, 1, 18),
    darkSteel,
    [collarAt(a.clone().add(new THREE.Vector3(0, 0, -0.3)), new THREE.Vector3(0, 0, 1), 0.36, 0.6), collarAt(b.clone().add(new THREE.Vector3(0, 0.3, 0)), UP, 0.36, 0.6)],
    'jumper-connectors',
  );
  tagSemantic(connectors, CLASSES.jumper.id);
  meshes.push(connectors);

  // Umbilical: UTA -> along the seabed -> up into a J-tube on the jacket.
  const start = template.umbilicalStart;
  const bellmouth = jTubePoint(SEABED_Y + 1.2);
  const approach = bellmouth.clone().addScaledVector(legOutward(J_TUBE_LEG), 4);
  const plan = new THREE.SplineCurve([
    new THREE.Vector2(start.x + 2.5, start.z),
    new THREE.Vector2(THREE.MathUtils.lerp(start.x, approach.x, 0.35), THREE.MathUtils.lerp(start.z, approach.z, 0.35) + rng.range(-6, 6)),
    new THREE.Vector2(THREE.MathUtils.lerp(start.x, approach.x, 0.7), THREE.MathUtils.lerp(start.z, approach.z, 0.7) + rng.range(-6, 6)),
    new THREE.Vector2(approach.x, approach.z),
  ]);
  const ground = plan.getSpacedPoints(Math.ceil(plan.getLength())).map((p) => new THREE.Vector3(p.x, heightAt(p.x, p.y) + UMBILICAL_RADIUS, p.y));
  const umbilicalCurve = new THREE.CatmullRomCurve3([start, ...ground, bellmouth, jTubePoint(SEABED_Y + 2.5)], false, 'centripetal');
  const umbilical = new THREE.Mesh(new THREE.TubeGeometry(umbilicalCurve, ground.length * 3, UMBILICAL_RADIUS, 10, false), umbilicalMaterial);
  umbilical.name = 'umbilical';
  tagSemantic(umbilical, CLASSES.umbilical.id);
  meshes.push(umbilical);

  const jTube = instanced(
    new THREE.CylinderGeometry(1, 1, 1, 16),
    steel,
    [cylinderBetween(bellmouth, jTubePoint(J_TUBE_TOP), 0.2), collarAt(bellmouth, jTubePoint(J_TUBE_TOP).sub(bellmouth), 0.42, 0.7)],
    'j-tube',
  );
  tagSemantic(jTube, CLASSES.riser.id);
  const jClamps: THREE.Matrix4[] = [];
  for (let y = SEABED_Y + 4; y < J_TUBE_TOP; y += 4) jClamps.push(cylinderBetween(jTubePoint(y), legPoint(J_TUBE_LEG, y), 0.08));
  const jClampMesh = instanced(new THREE.CylinderGeometry(1, 1, 1, 10), darkSteel, jClamps, 'j-tube-clamps');
  tagSemantic(jClampMesh, CLASSES.riserClamp.id);
  meshes.push(jTube, jClampMesh);

  // Concrete mattresses protecting the umbilical near both ends and stabilising the pipeline near the PLET.
  const umbilicalPlan = new THREE.CatmullRomCurve3(ground);
  const mattressSpots: { center: THREE.Vector3; tangent: THREE.Vector3; bump: number; half: number }[] = [0.06, 0.14, 0.5, 0.88, 0.95].map((k) => ({
    center: umbilicalPlan.getPointAt(k),
    tangent: umbilicalPlan.getTangentAt(k),
    bump: UMBILICAL_RADIUS * 2.2,
    half: 0.55,
  }));
  for (const offset of [-0.035, 0.035]) {
    const k = THREE.MathUtils.clamp(u + offset, 0, 1);
    const p = pipeline.getPointAt(k);
    mattressSpots.push({ center: p, tangent: pipeline.getTangentAt(k), bump: p.y + PIPE.radius - heightAt(p.x, p.z), half: 1.1 });
  }
  mattressSpots.forEach((spot, i) => {
    const mattress = new THREE.Mesh(mattressGeometry(spot.center, spot.tangent, heightAt, spot.bump, spot.half), concrete);
    mattress.name = `mattress-${i}`;
    tagSemantic(mattress, CLASSES.mattress.id);
    meshes.push(mattress);
  });

  meshes.forEach((mesh) => {
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  });
  return { group, umbilical: umbilicalCurve, plet: pipePoint, pletTangent: pipeTangent.clone().setY(0).normalize() };
}

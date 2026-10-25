import * as THREE from 'three';
import type { BuiltScene, SceneModule } from '../../core/sceneModule';
import { lookAtTrajectory, type Trajectory } from '../../core/trajectory';
import { validateClasses } from '../../core/semantics';
import { createConnections } from './connections';
import { createDebris } from './debris';
import { createJacket } from './jacket';
import { CLASS_LIST, JACKET, SEABED_Y, SURFACE_Y, TEMPLATE } from './layout';
import { createPipeline } from './pipeline';
import { createTemplate } from './template';
import { createSeabed } from './terrain';

const MIN_CAMERA_CLEARANCE = 0.8;

/** Follows a seabed line from the side and above, looking a little ahead. */
function lineSurvey(
  name: string,
  curve: THREE.Curve<THREE.Vector3>,
  heightAt: (x: number, z: number) => number,
  offset: { side: number; up: number; ahead: number; speed: number },
): Trajectory {
  const length = curve.getLength();
  const eye: THREE.Vector3[] = [];
  const target: THREE.Vector3[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let s = 2; s < length - offset.ahead - 2; s += 1) {
    const u = s / length;
    const p = curve.getPointAt(u);
    const side = new THREE.Vector3().crossVectors(curve.getTangentAt(u), up).normalize();
    const e = p.clone().addScaledVector(side, offset.side).add(new THREE.Vector3(0, offset.up, 0));
    e.y = Math.max(e.y, heightAt(e.x, e.z) + MIN_CAMERA_CLEARANCE);
    eye.push(e);
    target.push(curve.getPointAt(Math.min(1, (s + offset.ahead) / length)));
  }
  return lookAtTrajectory(name, eye, target, offset.speed);
}

/** Orbits the template while descending, looking at the trees and manifold. */
function templateOrbit(): Trajectory {
  const eye: THREE.Vector3[] = [];
  const target: THREE.Vector3[] = [];
  const steps = 300;
  const turns = 1.25;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const angle = -Math.PI * 0.35 + k * turns * Math.PI * 2;
    const radius = THREE.MathUtils.lerp(15, 11, k);
    const y = SEABED_Y + THREE.MathUtils.lerp(8, 3.2, k);
    eye.push(new THREE.Vector3(TEMPLATE.center.x + Math.cos(angle) * radius, y, TEMPLATE.center.y + Math.sin(angle) * radius));
    target.push(new THREE.Vector3(TEMPLATE.center.x, SEABED_Y + 1.8, TEMPLATE.center.y));
  }
  return lookAtTrajectory('template-orbit', eye, target, 0.8);
}

function jacketDescent(): Trajectory {
  const eye: THREE.Vector3[] = [];
  const target: THREE.Vector3[] = [];
  const radius = JACKET.baseHalfWidth * 1.9;
  const top = SURFACE_Y - 6;
  const bottom = SEABED_Y + 3;
  const turns = 1.75;
  const steps = 360;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const angle = k * turns * Math.PI * 2;
    const y = THREE.MathUtils.lerp(top, bottom, k);
    eye.push(new THREE.Vector3(JACKET.center.x + Math.cos(angle) * radius, y, JACKET.center.y + Math.sin(angle) * radius));
    target.push(new THREE.Vector3(JACKET.center.x, y - 2, JACKET.center.y));
  }
  return lookAtTrajectory('jacket-descent', eye, target, 0.9);
}

function riserClimb(riser: THREE.Curve<THREE.Vector3>): Trajectory {
  const eye: THREE.Vector3[] = [];
  const target: THREE.Vector3[] = [];
  const toJacket = new THREE.Vector3();
  for (let k = 0.12; k <= 1; k += 0.01) {
    const p = riser.getPointAt(k);
    toJacket.set(JACKET.center.x - p.x, 0, JACKET.center.y - p.z).normalize();
    // Stand off on the far side of the riser from the jacket, rotated slightly for parallax.
    const offset = toJacket.clone().multiplyScalar(-3).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
    eye.push(p.clone().add(offset).add(new THREE.Vector3(0, 0.6, 0)));
    target.push(p);
  }
  return lookAtTrajectory('riser-climb', eye, target, 0.5);
}

/**
 * Valve intervention: descends to the PLET and creeps past its valve with the
 * skids about 0.35 m off the seabed, the way a work ROV lines up on a panel,
 * then backs out and climbs. Low enough for the thrusters to lift sediment.
 */
function valveApproach(plet: THREE.Vector3, along: THREE.Vector3, heightAt: (x: number, z: number) => number): Trajectory {
  // (along the pipe, height above seabed, across the pipe) relative to the PLET.
  // Negative across is away from the template and jumper; the pipeline
  // mattresses start about 5 m along the pipe on either side.
  const across = new THREE.Vector3(along.z, 0, -along.x);
  if (across.dot(new THREE.Vector3(TEMPLATE.center.x - plet.x, 0, TEMPLATE.center.y - plet.z)) > 0) across.negate();
  const path = new THREE.CatmullRomCurve3(
    [
      [-5, 5, 11],
      [-3.5, 2.5, 7],
      [-2.5, 1.0, 4.6],
      [0, 0.95, 4.4],
      [2.5, 1.0, 4.6],
      [3.5, 2.2, 7.5],
      [4, 3.5, 11],
    ].map(([a, h, c]) => plet.clone().addScaledVector(along, a).addScaledVector(across, c).setY(h)),
  );
  const valve = plet.clone().add(new THREE.Vector3(0, 0.75, 0));
  const eye = path.getSpacedPoints(160).map((p) => new THREE.Vector3(p.x, heightAt(p.x, p.z) + p.y, p.z));
  return lookAtTrajectory('valve-approach', eye, eye.map(() => valve), 0.35);
}

export const infrastructureScene: SceneModule = {
  id: 'infrastructure',
  label: 'Underwater infrastructure inspection',
  build({ seed, rng }): BuiltScene {
    validateClasses(CLASS_LIST);
    const root = new THREE.Group();
    root.name = 'infrastructure';

    const seabed = createSeabed(seed, rng);
    const jacket = createJacket(rng);
    const pipeline = createPipeline(rng, seabed.heightAt);
    const template = createTemplate(rng);
    const connections = createConnections(rng, seabed.heightAt, pipeline.curve, template);
    const debris = createDebris(seed, rng, seabed.heightAt, [pipeline.curve, connections.umbilical]);
    root.add(seabed.object, jacket, pipeline.group, template.group, connections.group, debris.group);

    const trajectories = [
      templateOrbit(),
      lineSurvey('pipeline-survey', pipeline.curve, seabed.heightAt, { side: 2.4, up: 1.5, ahead: 2, speed: 0.6 }),
      lineSurvey('umbilical-survey', connections.umbilical, seabed.heightAt, { side: 1.6, up: 1.8, ahead: 3, speed: 0.5 }),
      jacketDescent(),
      riserClimb(pipeline.riserCurve),
      valveApproach(connections.plet, connections.pletTangent, seabed.heightAt),
    ];

    return {
      root,
      classes: CLASS_LIST,
      water: { presetId: 'clear-ocean', turbidity: 0.08 },
      surfaceHeight: SURFACE_Y,
      spawn: trajectories[0].poses[0],
      groundHeight: seabed.heightAt,
      trajectories,
      update: (time) => debris.update(time),
      dispose: () => disposeTree(root),
    };
  },
};

function disposeTree(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m));
  });
  materials.forEach((material) => {
    Object.values(material).forEach((value) => {
      if (value instanceof THREE.Texture) value.dispose();
    });
    material.dispose();
  });
}

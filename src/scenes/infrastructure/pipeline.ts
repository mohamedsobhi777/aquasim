import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { tagSemantic } from '../../core/semantics';
import { patchUnderwater } from '../../core/water';
import { collarAt, cylinderBetween, instanced, restPipeOnGround } from './geometry';
import { legOutward, legPoint } from './jacket';
import { CLASSES, PIPE, SEABED_Y, TEMPLATE } from './layout';
import { makeFoulingTexture } from './textures';

/** Leg that the riser is clamped to (the one facing the incoming pipeline). */
const RISER_LEG = 0;
const RISER_STANDOFF = 1.5;
const RISER_TOP_Y = -3;
const SAMPLE_STEP = 1;

export interface Pipeline {
  group: THREE.Group;
  /** Centreline of the seabed section, for survey trajectories. */
  curve: THREE.CatmullRomCurve3;
  riserCurve: THREE.CatmullRomCurve3;
}

function riserPoint(y: number): THREE.Vector3 {
  return legPoint(RISER_LEG, y).addScaledVector(legOutward(RISER_LEG), RISER_STANDOFF);
}

/**
 * Meandering route on the seabed that runs straight past the template (where
 * the PLET sits) and ends just before the riser base.
 */
function planRoute(rng: Rng, heightAt: (x: number, z: number) => number): THREE.Vector3[] {
  const riserBase = riserPoint(SEABED_Y + 2);
  const end = new THREE.Vector2(riserBase.x - 4, riserBase.z);
  const plet = new THREE.Vector2(TEMPLATE.center.x, TEMPLATE.center.y - TEMPLATE.pletDistance);
  const waypoints = [
    new THREE.Vector2(-78, rng.range(-10, 20)),
    new THREE.Vector2(plet.x - 8, plet.y),
    plet,
    new THREE.Vector2(plet.x + 8, plet.y),
    new THREE.Vector2(-5, rng.range(-15, 5)),
    new THREE.Vector2(end.x - 10, end.y + rng.range(-4, 4)),
    end,
  ];
  const plan = new THREE.SplineCurve(waypoints);
  const count = Math.ceil(plan.getLength() / SAMPLE_STEP);
  const xz = plan.getSpacedPoints(count);
  const heights = restPipeOnGround(
    xz.map((p) => heightAt(p.x, p.y)),
    PIPE.radius,
  );
  return xz.map((p, i) => new THREE.Vector3(p.x, heights[i], p.y));
}

export function createPipeline(rng: Rng, heightAt: (x: number, z: number) => number): Pipeline {
  const group = new THREE.Group();
  group.name = 'pipeline';
  const route = planRoute(rng, heightAt);
  const curve = new THREE.CatmullRomCurve3(route, false, 'centripetal');

  const coating = patchUnderwater(
    new THREE.MeshStandardMaterial({
      roughness: 0.9,
      map: makeFoulingTexture(
        rng,
        { base: '#6f7268', blotches: ['#4f5a3a', '#8d8a78', '#3e4436', '#a7a28c'], blotchCount: 200, grain: 0.15 },
        [60, 1],
      ),
    }),
  );
  const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, route.length * 2, PIPE.radius, 18, false), coating);
  pipe.name = 'pipeline-main';
  pipe.castShadow = pipe.receiveShadow = true;
  tagSemantic(pipe, CLASSES.pipeline.id);

  // Riser: bends up from the pipeline end and follows the jacket leg.
  const end = route[route.length - 1];
  const tangent = curve.getTangentAt(1);
  const riserPoints = [
    end,
    end
      .clone()
      .addScaledVector(tangent, 2.2)
      .setY(end.y + 0.4),
  ];
  for (let y = SEABED_Y + 3; y <= RISER_TOP_Y; y += 3) riserPoints.push(riserPoint(y));
  const riserCurve = new THREE.CatmullRomCurve3(riserPoints, false, 'centripetal');
  const riser = new THREE.Mesh(new THREE.TubeGeometry(riserCurve, 160, PIPE.radius, 18, false), coating);
  riser.name = 'riser';
  riser.castShadow = riser.receiveShadow = true;
  tagSemantic(riser, CLASSES.riser.id);

  const ring = new THREE.CylinderGeometry(1, 1, 1, 24, 1);
  const length = curve.getLength();
  const joints: THREE.Matrix4[] = [];
  const anodes: THREE.Matrix4[] = [];
  for (let s = PIPE.jointSpacing, n = 1; s < length; s += PIPE.jointSpacing, n++) {
    const u = s / length;
    joints.push(collarAt(curve.getPointAt(u), curve.getTangentAt(u), PIPE.radius * 1.07, 0.4));
    if (n % PIPE.anodeEveryJoints === 0) {
      const ua = (s + PIPE.jointSpacing / 2) / length;
      if (ua < 1) anodes.push(collarAt(curve.getPointAt(ua), curve.getTangentAt(ua), PIPE.radius * 1.16, 0.6));
    }
  }
  const jointMaterial = patchUnderwater(
    new THREE.MeshStandardMaterial({ color: 0x5a5c55, roughness: 0.7, metalness: 0.3 }),
  );
  const anodeMaterial = patchUnderwater(
    new THREE.MeshStandardMaterial({ color: 0xb9b8ae, roughness: 0.45, metalness: 0.6 }),
  );
  const jointMesh = instanced(ring, jointMaterial, joints, 'field-joints');
  const anodeMesh = instanced(ring, anodeMaterial, anodes, 'anodes');
  tagSemantic(jointMesh, CLASSES.fieldJoint.id);
  tagSemantic(anodeMesh, CLASSES.anode.id);

  // Supports under free spans, spaced along each span.
  const supports: THREE.Matrix4[] = [];
  let sinceLast = Infinity;
  for (let s = 0; s < length; s += 0.5) {
    const u = s / length;
    const p = curve.getPointAt(u);
    const ground = heightAt(p.x, p.z);
    const gap = p.y - PIPE.radius - ground;
    sinceLast += 0.5;
    if (gap < PIPE.supportGap || sinceLast < PIPE.supportSpacing) continue;
    sinceLast = 0;
    const t = curve.getTangentAt(u);
    const height = gap + 0.25;
    const yaw = Math.atan2(t.x, t.z);
    supports.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, ground + height / 2 - 0.15, p.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        new THREE.Vector3(1.6, height, 0.9),
      ),
    );
  }
  const supportMaterial = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x8a8577, roughness: 0.95 }));
  const supportMesh = instanced(new THREE.BoxGeometry(1, 1, 1), supportMaterial, supports, 'pipe-supports');
  tagSemantic(supportMesh, CLASSES.pipeSupport.id);

  // Clamps tie the riser to the leg.
  const clamps: THREE.Matrix4[] = [];
  for (let y = SEABED_Y + 6; y <= RISER_TOP_Y; y += 6) {
    clamps.push(cylinderBetween(riserPoint(y), legPoint(RISER_LEG, y), 0.12));
    clamps.push(collarAt(riserPoint(y), riserPoint(y + 1).sub(riserPoint(y - 1)), PIPE.radius * 1.25, 0.35));
  }
  const clampMesh = instanced(ring, jointMaterial, clamps, 'riser-clamps');
  tagSemantic(clampMesh, CLASSES.riserClamp.id);

  group.add(pipe, riser, jointMesh, anodeMesh, supportMesh, clampMesh);
  return { group, curve, riserCurve };
}

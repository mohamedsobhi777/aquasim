import * as THREE from 'three';
import { disposeTree } from '../../core/dispose';
import type { BuiltScene, SceneModule } from '../../core/sceneModule';
import { validateClasses } from '../../core/semantics';
import { lookAtTrajectory, type Trajectory } from '../../core/trajectory';
import { createColonies, type Colony } from './colonies';
import { CLASS_LIST, FIELD_SIZE, SURFACE_Y } from './layout';
import { createReefSeabed } from './terrain';

type HeightAt = (x: number, z: number) => number;

/** Survey altitude for transects, as used in photo-quadrat reef monitoring. */
const TRANSECT_ALTITUDE = 2.2;
const TRANSECT_SPACING = 6;
const MIN_CLEARANCE = 0.6;

/**
 * Lawnmower transect over the reef at constant altitude, camera pitched
 * down to look at the bottom a few metres ahead.
 */
function reefTransect(heightAt: HeightAt): Trajectory {
  const half = FIELD_SIZE / 2 - 10;
  const eye: THREE.Vector3[] = [];
  const target: THREE.Vector3[] = [];
  const legs = Math.floor((2 * half) / TRANSECT_SPACING) + 1;
  for (let leg = 0; leg < legs; leg++) {
    const z = -half + leg * TRANSECT_SPACING;
    const dir = leg % 2 === 0 ? 1 : -1;
    for (let s = 0; s <= 2 * half; s += 0.5) {
      const x = -half * dir + s * dir;
      eye.push(new THREE.Vector3(x, heightAt(x, z) + TRANSECT_ALTITUDE, z));
      const ahead = x + 2.5 * dir;
      target.push(new THREE.Vector3(ahead, heightAt(ahead, z), z));
    }
  }
  return lookAtTrajectory('reef-transect', eye, target, 0.5);
}

/** Circles one colony while descending, for multi-view images of a single coral. */
function colonyOrbit(colony: Colony, heightAt: HeightAt): Trajectory {
  const eye: THREE.Vector3[] = [];
  const target: THREE.Vector3[] = [];
  const steps = 240;
  const centre = colony.base.clone().add(new THREE.Vector3(0, colony.height * 0.5, 0));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const angle = k * Math.PI * 2.5;
    const radius = THREE.MathUtils.lerp(4, 2.2, k) + colony.radius;
    const x = centre.x + Math.cos(angle) * radius;
    const z = centre.z + Math.sin(angle) * radius;
    const y = Math.max(centre.y + THREE.MathUtils.lerp(2.5, 0.8, k), heightAt(x, z) + MIN_CLEARANCE);
    eye.push(new THREE.Vector3(x, y, z));
    target.push(centre);
  }
  return lookAtTrajectory('colony-orbit', eye, target, 0.4);
}

/** Low glide through the colonies, close enough to the bottom to lift sediment. */
function patchGlide(colonies: readonly Colony[], heightAt: HeightAt): Trajectory {
  const ordered = [...colonies].sort((a, b) => a.base.x - b.base.x);
  const stops = ordered.filter((_, i) => i % Math.max(1, Math.floor(ordered.length / 8)) === 0);
  const path = new THREE.CatmullRomCurve3(
    stops.map((c) => new THREE.Vector3(c.base.x, 0, c.base.z + c.radius + 1.6)),
    false,
    'centripetal',
  );
  const points = path.getSpacedPoints(Math.max(2, Math.round(path.getLength() / 0.5)));
  const eye = points.map((p) => new THREE.Vector3(p.x, heightAt(p.x, p.z) + 1.2, p.z));
  const target = points.map((p, i) => {
    const next = points[Math.min(points.length - 1, i + 6)];
    const dir = next.clone().sub(p).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    const look = p
      .clone()
      .addScaledVector(dir, 3)
      .add(new THREE.Vector3(0, 0, -1.2));
    return look.setY(heightAt(look.x, look.z) + 0.3);
  });
  return lookAtTrajectory('patch-glide', eye, target, 0.4);
}

export const coralScene: SceneModule = {
  id: 'coral',
  label: 'Coral reef monitoring',
  build({ seed, rng }): BuiltScene {
    validateClasses(CLASS_LIST);
    const root = new THREE.Group();
    root.name = 'coral-reef';

    const seabed = createReefSeabed(seed, rng);
    const { group, colonies } = createColonies(seed, rng, seabed.heightAt);
    root.add(seabed.object, group);

    const largest = colonies.filter((c) => c.kind === 'brain').sort((a, b) => b.radius - a.radius)[0] ?? colonies[0];
    const trajectories = [
      reefTransect(seabed.heightAt),
      colonyOrbit(largest, seabed.heightAt),
      patchGlide(colonies, seabed.heightAt),
    ];

    return {
      root,
      classes: CLASS_LIST,
      water: { presetId: 'clear-ocean', turbidity: 0.05 },
      surfaceHeight: SURFACE_Y,
      spawn: trajectories[1].poses[0],
      groundHeight: seabed.heightAt,
      trajectories,
      dispose: () => disposeTree(root),
    };
  },
};

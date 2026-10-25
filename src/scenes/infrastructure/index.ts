import * as THREE from 'three';
import { disposeTree } from '../../core/dispose';
import { lookAtPose } from '../../core/pose';
import type { BuiltScene, SceneModule } from '../../core/sceneModule';
import { SURFACE_Y } from './layout';
import { createRocks } from './rocks';
import { createSeabed } from './terrain';

/** Start a few metres above the seabed, this far from the nearest rock outcrop and looking at it. */
const SPAWN_HEIGHT = 3;
const SPAWN_DISTANCE = 10;

export const infrastructureScene: SceneModule = {
  id: 'infrastructure',
  label: 'Underwater infrastructure inspection',
  build({ seed, rng }): BuiltScene {
    const root = new THREE.Group();
    root.name = 'infrastructure';

    const seabed = createSeabed(seed, rng);
    const rocks = createRocks(seed, rng, seabed.heightAt);
    root.add(seabed.object, rocks.object);

    const outcrop = rocks.outcrops.reduce((a, b) => (b.length() < a.length() ? b : a));
    const target = new THREE.Vector3(outcrop.x, seabed.heightAt(outcrop.x, outcrop.y), outcrop.y);
    const eye = target.clone().add(new THREE.Vector3(SPAWN_DISTANCE, 0, 0));
    eye.y = seabed.heightAt(eye.x, eye.z) + SPAWN_HEIGHT;

    return {
      root,
      turbidity: 0.08,
      surfaceHeight: SURFACE_Y,
      spawn: lookAtPose(eye, target),
      groundHeight: seabed.heightAt,
      dispose: () => disposeTree(root),
    };
  },
};

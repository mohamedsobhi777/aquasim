import * as THREE from 'three';
import { disposeTree } from '../../core/dispose';
import { lookAtPose } from '../../core/pose';
import type { BuiltScene, SceneModule } from '../../core/sceneModule';
import { createColonies } from './colonies';
import { SURFACE_Y } from './layout';
import { createReefSeabed } from './terrain';

export const coralScene: SceneModule = {
  id: 'coral',
  label: 'Coral reef monitoring',
  build({ seed, rng }): BuiltScene {
    const root = new THREE.Group();
    root.name = 'coral-reef';

    const seabed = createReefSeabed(seed, rng);
    const { group, colonies } = createColonies(seed, rng, seabed.heightAt);
    root.add(seabed.object, group);

    // Start a few metres from the largest brain coral, looking at it.
    const brains = colonies.filter((c) => c.kind === 'brain').sort((a, b) => b.radius - a.radius);
    const focus = brains[0] ?? colonies[0];
    const target = focus.base.clone().add(new THREE.Vector3(0, focus.height * 0.5, 0));
    const eye = target.clone().add(new THREE.Vector3(3 + focus.radius, 2, 3 + focus.radius));
    eye.y = Math.max(eye.y, seabed.heightAt(eye.x, eye.z) + 1);

    return {
      root,
      turbidity: 0.05,
      surfaceHeight: SURFACE_Y,
      spawn: lookAtPose(eye, target),
      groundHeight: seabed.heightAt,
      dispose: () => disposeTree(root),
    };
  },
};

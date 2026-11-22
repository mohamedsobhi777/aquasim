import * as THREE from 'three';
import { disposeTree } from '../../core/dispose';
import { createPipeline } from './pipeline';
import type { BuiltScene, SceneModule } from '../../core/sceneModule';
import { SURFACE_Y } from './layout';
import { createRocks } from './rocks';
import { createSeabed } from './terrain';

import { CLASSES } from '../infrastructure/layout';
import { tagSemantic } from '../../core/semantics';

export const pipeSite: SceneModule = {
  id: 'infrastructure',
  label: 'Pipe flange inspection',
  build({ seed, rng }): BuiltScene {
    const root = new THREE.Group();
    root.name = 'infrastructure';

    const seabed = createSeabed(seed, rng);
    const pipeline = createPipeline(seabed.heightAt);
    const rocks = createRocks(seed, rng, seabed.heightAt, pipeline.allowsRock);
    tagSemantic(seabed.object, CLASSES.seabed.id);
    tagSemantic(rocks, CLASSES.rock.id);
    const poses = Array.from({ length: 101 }, (_, i) => {
      const t = (i / 100) * pipeline.route.duration;
      return { ...pipeline.route.poseAt(t), t };
    });
    root.add(seabed.object, rocks, pipeline.group);

    root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = object.receiveShadow = true;
    });
    return {
      root,
      classes: [CLASSES.seabed, CLASSES.pipeline, CLASSES.pipeSupport, CLASSES.fieldJoint, CLASSES.rock],
      water: { presetId: 'clear-ocean', turbidity: 0.08 },
      surfaceHeight: SURFACE_Y,
      spawn: poses[0],
      trajectories: [{ name: 'pipe-flange', poses }],
      groundHeight: seabed.heightAt,
      dispose: () => disposeTree(root),
    };
  },
};

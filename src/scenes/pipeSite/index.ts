import * as THREE from 'three';
import { disposeTree } from '../../core/dispose';
import { createRng } from '../../core/rng';
import { makeFoulingTexture } from '../../core/textures';
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
    const coatingMap = makeFoulingTexture(
      createRng(seed),
      { base: '#c29a50', blotches: ['#5c5039', '#70543c', '#7b7850', '#c4ad74'], blotchCount: 185, grain: 0.12 },
      [1, 4],
    );
    const pipeline = createPipeline(seabed.heightAt, coatingMap, seed);
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
      setCaustics: seabed.setCaustics,
      surfaceHeight: SURFACE_Y,
      spawn: poses[0],
      trajectories: [{ name: 'pipe-flange', poses }],
      groundHeight: seabed.heightAt,
      dispose: () => disposeTree(root),
    };
  },
};

import * as THREE from 'three';
import { labelSlotOf } from './lod';
import { MAX_INSTANCE_ID, isExcludedFromLabels, semanticIdOf, type SemanticClass } from './semantics';

export type LabelPassKind = 'depth' | 'semantic';

/**
 * Optional vertex deformation that a scene applies in its RGB material
 * (e.g. current-driven sway). Label passes inject the same GLSL after
 * `#include <begin_vertex>` with the same uniform objects, so depth and masks
 * stay aligned with the deformed RGB geometry.
 */
export interface VertexDeformation {
  /** GLSL declarations (uniforms, functions) placed before main(). */
  pars: string;
  /** GLSL that modifies `transformed` (object space). */
  body: string;
  uniforms: Record<string, THREE.IUniform>;
}

export interface InstanceRecord {
  /** First instance id (InstancedMesh instances are consecutive). */
  instanceId: number;
  count: number;
  classId: number;
  className: string;
  objectName: string;
}

interface LabelData {
  instanceBase?: number;
  deformation?: VertexDeformation;
}

export function setVertexDeformation(mesh: THREE.Mesh, deformation: VertexDeformation): void {
  (mesh.userData as LabelData).deformation = deformation;
}

const vertexShader = (deform?: VertexDeformation): string => /* glsl */ `
${deform?.pars ?? ''}
flat varying float vInstance;
varying float vViewDepth;
#ifdef USE_LABEL_INDEX
  // Stable index for meshes whose instances are re-ordered per frame (LOD).
  attribute float labelIndex;
#endif
void main() {
  #include <begin_vertex>
  ${deform?.body ?? ''}
  #include <project_vertex>
  #ifdef USE_LABEL_INDEX
    vInstance = labelIndex;
  #else
    vInstance = float( gl_InstanceID );
  #endif
  vViewDepth = -mvPosition.z;
}
`;

const fragmentShader = /* glsl */ `
uniform float uClassId;
uniform float uInstanceBase;
uniform float uVisualize;
uniform vec3 uVisColor;
uniform float uDepthVisScale;
flat varying float vInstance;
varying float vViewDepth;
void main() {
  #ifdef DEPTH_PASS
    if ( uVisualize > 0.5 ) {
      float v = exp( -vViewDepth / uDepthVisScale );
      gl_FragColor = vec4( vec3( v ), 1.0 );
    } else {
      gl_FragColor = vec4( vViewDepth, 0.0, 0.0, 1.0 );
    }
  #else
    float id = uInstanceBase + vInstance;
    if ( uVisualize > 0.5 ) {
      float shade = 0.7 + 0.3 * fract( sin( id * 12.9898 ) * 43758.5453 );
      gl_FragColor = vec4( uVisColor * shade, 1.0 );
    } else {
      gl_FragColor = vec4( uClassId, floor( id / 256.0 ), mod( id, 256.0 ), 255.0 ) / 255.0;
    }
  #endif
}
`;

interface ObjectLabelMaterials {
  depth: THREE.ShaderMaterial;
  semantic: THREE.ShaderMaterial;
}

/** Swaps scene materials for depth / semantic-id passes and restores them afterwards. */
export class LabelPasses {
  private readonly materials = new Map<THREE.Mesh, ObjectLabelMaterials>();
  private readonly visColors = new Map<number, THREE.Color>();
  depthVisScale = 12;

  /** Assigns instance ids under `root` (starting at 1; 0 means no surface) and returns the instance table. */
  prepare(root: THREE.Object3D, classes: readonly SemanticClass[]): InstanceRecord[] {
    this.disposeMaterials();
    this.visColors.clear();
    for (const c of classes)
      this.visColors.set(
        c.id,
        new THREE.Color().setRGB(c.color[0] / 255, c.color[1] / 255, c.color[2] / 255, THREE.SRGBColorSpace),
      );

    const names = new Map(classes.map((c) => [c.id, c.name]));
    const records: InstanceRecord[] = [];
    let next = 1;
    // Meshes sharing a label slot (the LOD levels of one object) share one block of ids.
    const slotBases = new Map<object, number>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || isExcludedFromLabels(object)) return;
      const slot = labelSlotOf(object);
      const known = slot ? slotBases.get(slot.key) : undefined;
      if (known !== undefined) {
        (object.userData as LabelData).instanceBase = known;
        return;
      }
      const classId = semanticIdOf(object) ?? 0;
      const count = slot ? slot.count : object instanceof THREE.InstancedMesh ? object.count : 1;
      if (next + count - 1 > MAX_INSTANCE_ID) throw new Error(`Too many label instances (> ${MAX_INSTANCE_ID})`);
      (object.userData as LabelData).instanceBase = next;
      if (slot) slotBases.set(slot.key, next);
      records.push({
        instanceId: next,
        count,
        classId,
        className: names.get(classId) ?? 'unlabeled',
        objectName: slot?.name ?? object.name,
      });
      next += count;
    });
    return records;
  }

  private materialsFor(mesh: THREE.Mesh): ObjectLabelMaterials {
    const cached = this.materials.get(mesh);
    if (cached) return cached;

    const data = mesh.userData as LabelData;
    const classId = semanticIdOf(mesh) ?? 0;
    const original = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const make = (kind: LabelPassKind): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        name: `label-${kind}`,
        defines: {
          ...(kind === 'depth' ? { DEPTH_PASS: '' } : {}),
          ...(mesh.geometry.getAttribute('labelIndex') ? { USE_LABEL_INDEX: '' } : {}),
        },
        uniforms: {
          ...(data.deformation?.uniforms ?? {}),
          uClassId: { value: classId },
          uInstanceBase: { value: data.instanceBase ?? 0 },
          uVisualize: { value: 0 },
          uVisColor: { value: this.visColors.get(classId) ?? new THREE.Color(0x777777) },
          uDepthVisScale: { value: this.depthVisScale },
        },
        vertexShader: vertexShader(data.deformation),
        fragmentShader,
        side: original?.side ?? THREE.FrontSide,
        toneMapped: false,
      });
    const created = { depth: make('depth'), semantic: make('semantic') };
    this.materials.set(mesh, created);
    return created;
  }

  /**
   * Runs `render` with every labelled mesh using its pass material. Visual-only
   * objects (particles, backdrop) and non-mesh objects are hidden.
   */
  withPass(scene: THREE.Scene, kind: LabelPassKind, visualize: boolean, render: () => void): void {
    const restoreMaterial = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const restoreVisible: THREE.Object3D[] = [];
    const background = scene.background;

    scene.traverse((object) => {
      if (!object.visible) return;
      const isMesh = object instanceof THREE.Mesh;
      if (
        isExcludedFromLabels(object) ||
        (!isMesh && (object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.Sprite))
      ) {
        object.visible = false;
        restoreVisible.push(object);
        return;
      }
      if (!isMesh) return;
      const material = this.materialsFor(object)[kind];
      material.uniforms.uVisualize.value = visualize ? 1 : 0;
      material.uniforms.uDepthVisScale.value = this.depthVisScale;
      restoreMaterial.set(object, object.material);
      object.material = material;
    });

    scene.background = null;
    try {
      render();
    } finally {
      scene.background = background;
      restoreMaterial.forEach((material, mesh) => (mesh.material = material));
      restoreVisible.forEach((object) => (object.visible = true));
    }
  }

  private disposeMaterials(): void {
    this.materials.forEach(({ depth, semantic }) => {
      depth.dispose();
      semantic.dispose();
    });
    this.materials.clear();
  }

  dispose(): void {
    this.disposeMaterials();
  }
}

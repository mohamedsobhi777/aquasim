import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../core/rng';
import { tagSemantic } from '../../core/semantics';
import { patchUnderwater } from '../../core/water';
import { cylinderBetween, instanced } from './geometry';
import { CLASSES, SEABED_Y, TEMPLATE } from './layout';
import { makeFoulingTexture } from '../../core/textures';

const MEMBER = 0.32;
const HEADER_Y = 1.4;
const HEADER_RADIUS = 0.24;
/** Well slots (local x, z); trees sit in the four bays around the manifold. */
const WELLS: readonly [number, number][] = [
  [-3.6, -2.7],
  [3.6, -2.7],
  [-3.6, 2.7],
  [3.6, 2.7],
];

export interface SubseaTemplate {
  group: THREE.Group;
  /** World point where the jumper connects (manifold export hub, facing the pipeline). */
  jumperHub: THREE.Vector3;
  /** World point where the umbilical leaves the umbilical termination assembly. */
  umbilicalStart: THREE.Vector3;
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export function placed(
  geometry: THREE.BufferGeometry,
  position: THREE.Vector3,
  rotation = new THREE.Euler(),
): THREE.BufferGeometry {
  return geometry.applyMatrix4(
    new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(1, 1, 1)),
  );
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('template: could not merge geometries (attribute mismatch)');
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Christmas tree: wellhead, valve block, side wing valves and a tree cap. Origin at the seabed. */
function treeGeometry(): THREE.BufferGeometry {
  return merge([
    placed(new THREE.CylinderGeometry(0.42, 0.5, 1.1, 20), v(0, 0.55, 0)),
    placed(new THREE.BoxGeometry(1.3, 1.5, 1.3), v(0, 1.85, 0)),
    placed(new THREE.CylinderGeometry(0.22, 0.22, 2.2, 14), v(0, 1.7, 0), new THREE.Euler(0, 0, Math.PI / 2)),
    placed(new THREE.BoxGeometry(0.5, 0.5, 0.5), v(1.1, 1.7, 0)),
    placed(new THREE.BoxGeometry(0.5, 0.5, 0.5), v(-1.1, 1.7, 0)),
    placed(new THREE.CylinderGeometry(0.38, 0.45, 0.7, 20), v(0, 2.95, 0)),
    placed(new THREE.CylinderGeometry(0.18, 0.18, 0.35, 12), v(0, 3.45, 0)),
  ]);
}

/** Gate valve: body, bonnet/actuator and handwheel. Origin at the pipe axis. */
export function valveGeometry(): THREE.BufferGeometry {
  return merge([
    new THREE.BoxGeometry(0.55, 0.55, 0.55),
    placed(new THREE.CylinderGeometry(0.14, 0.14, 0.5, 12), v(0, 0.5, 0)),
    placed(new THREE.TorusGeometry(0.26, 0.035, 8, 24), v(0, 0.78, 0), new THREE.Euler(Math.PI / 2, 0, 0)),
  ]);
}

/** ROV intervention panel: plate, two grab handles and a torque bucket. Faces +x. */
function panelGeometry(): THREE.BufferGeometry {
  return merge([
    new THREE.BoxGeometry(0.06, 0.8, 1.0),
    placed(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), v(0.12, 0.3, 0)),
    placed(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), v(0.12, -0.3, 0)),
    placed(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 16), v(0.1, 0, 0.25), new THREE.Euler(0, 0, Math.PI / 2)),
  ]);
}

function frameMembers(): THREE.Matrix4[] {
  const { halfX: hx, halfZ: hz, height: h } = TEMPLATE;
  const mid = 2.3;
  const members: THREE.Matrix4[] = [];
  const beam = (a: THREE.Vector3, b: THREE.Vector3, size = MEMBER): void => {
    members.push(cylinderBetween(a, b, size));
  };

  const xs = [-hx, 0, hx];
  for (const x of xs) {
    for (const z of [-hz, hz]) beam(v(x, 0.3, z), v(x, h, z));
  }
  for (const y of [0.45, h]) {
    beam(v(-hx, y, -hz), v(hx, y, -hz));
    beam(v(-hx, y, hz), v(hx, y, hz));
    beam(v(-hx, y, -hz), v(-hx, y, hz));
    beam(v(hx, y, -hz), v(hx, y, hz));
  }
  // Mid rail on the long sides; the -z side stays open for ROV access and the jumper.
  beam(v(-hx, mid, hz), v(hx, mid, hz));
  beam(v(-hx, mid, -hz), v(-hx, mid, hz));
  beam(v(hx, mid, -hz), v(hx, mid, hz));
  // Side bracing.
  for (const sx of [-hx, hx]) {
    beam(v(sx, 0.45, -hz), v(sx, mid, 0), MEMBER * 0.8);
    beam(v(sx, mid, 0), v(sx, 0.45, hz), MEMBER * 0.8);
    beam(v(sx, mid, -hz), v(sx, h, 0), MEMBER * 0.8);
    beam(v(sx, h, 0), v(sx, mid, hz), MEMBER * 0.8);
  }
  for (let x = -hx + 2; x < hx; x += 2) beam(v(x, mid, hz), v(x + 1, h, hz), MEMBER * 0.7);
  // Roof grid.
  for (const x of xs) beam(v(x, h, -hz), v(x, h, hz));
  beam(v(-hx, h, 0), v(hx, h, 0));
  return members;
}

export function createTemplate(rng: Rng): SubseaTemplate {
  const group = new THREE.Group();
  group.name = 'subsea-template';
  group.position.set(TEMPLATE.center.x, SEABED_Y, TEMPLATE.center.y);
  const { halfX: hx, halfZ: hz, height: h } = TEMPLATE;

  const paint = patchUnderwater(
    new THREE.MeshStandardMaterial({
      roughness: 0.7,
      map: makeFoulingTexture(
        rng,
        { base: '#d4a21c', blotches: ['#7b6a2a', '#5f6b3a', '#a8762b', '#c9bf9a'], blotchCount: 180, grain: 0.12 },
        [1, 4],
      ),
    }),
  );
  const steel = patchUnderwater(
    new THREE.MeshStandardMaterial({
      roughness: 0.55,
      metalness: 0.45,
      map: makeFoulingTexture(
        rng,
        { base: '#8f938c', blotches: ['#5c6650', '#a47a4a', '#c6c1aa'], blotchCount: 120, grain: 0.1 },
        [1, 1],
      ),
    }),
  );
  const darkSteel = patchUnderwater(
    new THREE.MeshStandardMaterial({ color: 0x3c4245, roughness: 0.5, metalness: 0.5 }),
  );
  const orange = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xe8901a, roughness: 0.6 }));
  const concrete = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x7d7a70, roughness: 0.95 }));

  const frame = instanced(new THREE.BoxGeometry(1, 1, 1), paint, frameMembers(), 'template-frame');
  tagSemantic(frame, CLASSES.templateFrame.id);

  // Roof hatches over two bays; the others are open so trees are visible from above.
  const hatches = instanced(
    new THREE.BoxGeometry(1, 1, 1),
    paint,
    [
      new THREE.Matrix4().compose(v(-hx / 2, h + 0.12, -hz / 2), new THREE.Quaternion(), v(hx - 0.4, 0.1, hz - 0.4)),
      new THREE.Matrix4().compose(v(hx / 2, h + 0.12, hz / 2), new THREE.Quaternion(), v(hx - 0.4, 0.1, hz - 0.4)),
    ],
    'roof-hatches',
  );
  tagSemantic(hatches, CLASSES.templateFrame.id);

  const foundation = instanced(
    new THREE.BoxGeometry(1, 1, 1),
    concrete,
    [new THREE.Matrix4().compose(v(0, 0.15, 0), new THREE.Quaternion(), v(hx * 2 + 1.2, 0.3, hz * 2 + 1.2))],
    'template-foundation',
  );
  tagSemantic(foundation, CLASSES.mudmat.id);

  const treeMatrices = WELLS.map(([x, z]) => new THREE.Matrix4().makeTranslation(x, 0.3, z));
  const trees = instanced(treeGeometry(), steel, treeMatrices, 'xmas-trees');
  tagSemantic(trees, CLASSES.xmasTree.id);

  // Manifold: header along x, branches to each tree, export line toward the pipeline (-z).
  const header: THREE.Matrix4[] = [
    cylinderBetween(v(-hx + 1, HEADER_Y, 0), v(hx - 1, HEADER_Y, 0), HEADER_RADIUS),
    cylinderBetween(v(0, HEADER_Y, 0), v(0, HEADER_Y, -hz - 0.4), HEADER_RADIUS),
  ];
  const valves: THREE.Matrix4[] = [new THREE.Matrix4().makeTranslation(0, HEADER_Y, -hz + 1.6)];
  for (const [x, z] of WELLS) {
    const branchEnd = v(x, HEADER_Y, z - Math.sign(z) * 0.75);
    header.push(cylinderBetween(v(x, HEADER_Y, 0), branchEnd, HEADER_RADIUS * 0.7));
    valves.push(new THREE.Matrix4().makeTranslation(x, HEADER_Y, z * 0.45));
  }
  for (const x of [-hx + 1, hx - 1]) valves.push(new THREE.Matrix4().makeTranslation(x, HEADER_Y, 0));
  const manifold = instanced(new THREE.CylinderGeometry(1, 1, 1, 16), darkSteel, header, 'manifold-piping');
  tagSemantic(manifold, CLASSES.manifold.id);
  const valveMesh = instanced(valveGeometry(), darkSteel, valves, 'valves');
  tagSemantic(valveMesh, CLASSES.valve.id);

  // ROV panels on the outward face of each tree.
  const panelMatrices = WELLS.map(([x, z]) => {
    const side = Math.sign(x);
    return new THREE.Matrix4().compose(
      v(x + side * 0.72, 2.3, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side > 0 ? 0 : Math.PI, 0)),
      v(1, 1, 1),
    );
  });
  const panels = instanced(panelGeometry(), orange, panelMatrices, 'rov-panels');
  tagSemantic(panels, CLASSES.rovPanel.id);

  // Umbilical termination assembly on the +x side.
  const utaPosition = v(hx + 2.2, 0, 2);
  const uta = new THREE.Mesh(
    merge([
      placed(new THREE.BoxGeometry(2.4, 0.25, 2.0), v(0, 0.12, 0)),
      placed(new THREE.BoxGeometry(1.6, 1.2, 1.2), v(0, 0.85, 0)),
      placed(new THREE.CylinderGeometry(0.16, 0.2, 1.0, 12), v(1.1, 0.7, 0), new THREE.Euler(0, 0, Math.PI / 2)),
    ]),
    orange,
  );
  uta.name = 'uta';
  uta.position.copy(utaPosition);
  tagSemantic(uta, CLASSES.uta.id);

  [frame, hatches, foundation, trees, manifold, valveMesh, panels, uta].forEach((mesh) => {
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  });
  group.updateMatrixWorld(true);

  return {
    group,
    jumperHub: group.localToWorld(v(0, HEADER_Y, -hz - 0.4)),
    umbilicalStart: group.localToWorld(utaPosition.clone().add(v(1.6, 0.7, 0))),
  };
}

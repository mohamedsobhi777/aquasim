import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The support uses pipe-axis coordinates so the circular seat and retaining band
// meet the same pipe, even where the height of the concrete pier changes.
export function pipeSupportGeometry(radius: number, bottom: number, footingTop: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  function part(geometry: THREE.BufferGeometry, color: number) {
    const mesh = geometry.index ? geometry.toNonIndexed() : geometry;
    const tint = new THREE.Color(color);
    const colors = new Float32Array(mesh.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    mesh.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(mesh);
    if (mesh !== geometry) geometry.dispose();
  }
  // Extrude a transverse section along the pipeline. Horizontal coordinates
  // in the section become -Z in the scene.
  function section(profile: THREE.Shape, length: number, bevel: number) {
    return new THREE.ExtrudeGeometry(profile, {
      depth: length,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: 18,
    })
      .translate(0, 0, -length / 2)
      .rotateY(Math.PI / 2);
  }
  const footing = new THREE.Shape();
  footing.moveTo(-0.96, bottom);
  footing.lineTo(0.96, bottom);
  footing.lineTo(0.96, footingTop - 0.09);
  footing.lineTo(0.85, footingTop);
  footing.lineTo(-0.85, footingTop);
  footing.lineTo(-0.96, footingTop - 0.09);
  footing.closePath();
  part(section(footing, 1.1, 0.018), 0x8c8875);

  const pier = new THREE.Shape();
  pier.moveTo(-0.72, footingTop);
  pier.lineTo(0.72, footingTop);
  pier.lineTo(0.54, -radius - 0.12);
  pier.lineTo(-0.54, -radius - 0.12);
  pier.closePath();
  part(section(pier, 0.68, 0.018), 0xa19b84);

  const concreteVertices = parts.reduce((count, part) => count + part.getAttribute('position').count, 0);
  const seat = new THREE.Shape();
  seat.moveTo(-0.55, -radius - 0.12);
  seat.lineTo(0.55, -radius - 0.12);
  seat.lineTo(0.55, 0);
  seat.lineTo(radius, 0);
  seat.absarc(0, 0, radius, 0, -Math.PI, true);
  seat.lineTo(-0.55, 0);
  seat.closePath();
  part(section(seat, 0.43, 0), 0x686b60);

  const strap = new THREE.Shape();
  strap.absarc(0, 0, radius + 0.026, 0, Math.PI, false);
  strap.absarc(0, 0, radius, Math.PI, 0, true);
  strap.closePath();
  part(section(strap, 0.16, 0), 0x888675);
  for (const side of [-1, 1]) {
    part(new THREE.BoxGeometry(0.16, 0.025, 0.13).translate(0, 0.0125, side * (radius + 0.06)), 0x888675);
    part(new THREE.CylinderGeometry(0.036, 0.036, 0.028, 6).translate(0, 0.039, side * (radius + 0.085)), 0x534f46);
  }
  const joined = mergeGeometries(parts);
  joined.addGroup(0, concreteVertices, 0);
  joined.addGroup(concreteVertices, joined.getAttribute('position').count - concreteVertices, 1);
  parts.forEach((geometry) => geometry.dispose());
  return joined;
}

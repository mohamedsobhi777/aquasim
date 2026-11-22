import * as THREE from 'three';
import { setVertexDeformation, type VertexDeformation } from '../../core/labelPasses';
import { patchUnderwater } from '../../core/water';

/** Fan meshes have their origin at the attachment point and grow along local Y. */
export function createFanSway() {
  const time = { value: 0 };
  const current = { value: new THREE.Vector3() };
  const deformation: VertexDeformation = {
    uniforms: { uFanTime: time, uFanCurrent: current },
    pars: 'uniform float uFanTime; uniform vec3 uFanCurrent;',
    body: /* glsl */ `
      float height = clamp(transformed.y, 0.0, 1.5);
      float phase = dot(modelMatrix[3].xz, vec2(0.67, 0.39)) - 1.55 * uFanTime;
      float wave = 0.45 + 0.88 * sin(phase + height * 0.9)
                   + 0.22 * sin(1.7 * phase + 3.0 * transformed.x);
      // Convert the world current to the rotated colony frame. The saturating
      // response keeps the highest current setting from folding the fan over.
      vec3 flow = uFanCurrent * mat3(modelMatrix);
      transformed += flow * (height * height * wave / (1.0 + 2.8 * length(flow)));
    `,
  };
  const shadow = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  shadow.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, deformation.uniforms);
    shader.vertexShader =
      deformation.pars +
      '\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + deformation.body);
  };
  return {
    attach(mesh: THREE.Mesh, material: THREE.MeshStandardMaterial) {
      patchUnderwater(material, deformation);
      setVertexDeformation(mesh, deformation);
      mesh.customDepthMaterial = shadow;
      mesh.geometry.computeBoundingSphere();
      // Max tip travel at the upper current setting, including wave peaks.
      const sphere = mesh.geometry.boundingSphere!;
      mesh.geometry.computeBoundingBox();
      const height = THREE.MathUtils.clamp(mesh.geometry.boundingBox!.max.y, 0, 1.5);
      sphere.radius += 0.42 * height * height;
    },
    update(seconds: number, velocity: THREE.Vector3) {
      time.value = seconds;
      current.value.copy(velocity);
    },
    dispose: () => shadow.dispose(),
  };
}

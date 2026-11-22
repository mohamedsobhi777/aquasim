import * as THREE from 'three';
import { excludeFromLabels } from '../../core/semantics';
import { patchUnderwater } from '../../core/water';
import { FIELD_SIZE, SURFACE_Y } from './layout';

/** Height and horizontal gradient of two crossing swells. Coordinates and amplitudes are in metres. */
const waves = /* glsl */ `
  uniform float uWaveTime;
  vec3 swell(vec2 p) {
    vec2 k1 = vec2(0.91, 0.53), k2 = vec2(-0.76, 1.36);
    float a = dot(k1, p) - 1.6 * uWaveTime, b = dot(k2, p) - 2.0 * uWaveTime;
    return vec3(0.12 * sin(a) + 0.055 * sin(b),
                0.12 * cos(a) * k1 + 0.055 * cos(b) * k2);
  }
  varying vec3 vWavePosition;
`;

export function createReefSurface() {
  const time = { value: 0 },
    light = { value: 1 };
  const material = patchUnderwater(new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
  const underwater = material.onBeforeCompile.bind(material);
  material.customProgramCacheKey = () => 'aquasim-water:reef-surface';
  material.onBeforeCompile = (shader, renderer) => {
    underwater(shader, renderer);
    shader.uniforms.uWaveTime = time;
    shader.uniforms.uSurfaceDaylight = light;
    shader.vertexShader =
      waves +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
      #include <begin_vertex>
      transformed.y += swell(transformed.xz).x;
      vWavePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `,
      );
    shader.fragmentShader =
      waves +
      'uniform float uSurfaceDaylight;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
      #include <color_fragment>
      vec2 p = vWavePosition.xz;
      vec2 slope = swell(p).yz;
      slope += vec2(0.065, -0.041) * cos(dot(p, vec2(4.2, -2.65)) - 3.3 * uWaveTime + sin(p.y));
      vec3 normalUp = normalize(vec3(-slope.x, 1.0, -slope.y));
      vec3 ray = normalize(vWavePosition - cameraPosition);
      // Looking out from water, sky is visible only within Snell's window.
      vec3 skyRay = refract(ray, -normalUp, 1.333);
      float window = smoothstep(0.0, 0.22, skyRay.y);
      vec3 sun = normalize(vec3(0.3, 1.0, 0.2));
      float glint = pow(max(dot(skyRay, sun), 0.0), 85.0);
      vec3 sky = mix(vec3(0.58, 0.82, 0.88), vec3(0.26, 0.57, 0.88), max(skyRay.y, 0.0));
      diffuseColor.rgb = uSurfaceDaylight * mix(vec3(0.018, 0.088, 0.105), sky + glint * vec3(2.8, 2.45, 1.8), window);
    `,
      );
  };
  const size = FIELD_SIZE * 2;
  const geometry = new THREE.PlaneGeometry(size, size, 160, 160).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = SURFACE_Y;
  mesh.name = 'reef-wave-surface';
  excludeFromLabels(mesh);
  return {
    mesh,
    update(seconds: number, daylight: number, visible: boolean) {
      time.value = seconds;
      light.value = daylight / 6;
      mesh.visible = visible;
    },
  };
}

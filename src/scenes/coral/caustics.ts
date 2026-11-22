import * as THREE from 'three';
import { SURFACE_Y } from './layout';

/** Modulate the reef's diffuse skylight before water attenuation. Lamps and labels use separate paths. */
export function addSeabedCaustics(material: THREE.MeshStandardMaterial) {
  const time = { value: 0 };
  const strength = { value: 0 };
  const underwater = material.onBeforeCompile.bind(material);
  const underwaterKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => underwaterKey + ':seabed-caustics';
  material.onBeforeCompile = (shader, renderer) => {
    underwater(shader, renderer);
    shader.uniforms.uCausticTime = time;
    shader.uniforms.uCausticStrength = strength;
    shader.vertexShader =
      'varying vec3 vSeabedPosition;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n vSeabedPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader =
      `
      varying vec3 vSeabedPosition;
      uniform float uCausticTime;
      uniform float uCausticStrength;
      // Ridges where two travelling wave phases meet, bent by a slower cross-wave.
      float causticRidge(vec2 p, float t) {
        vec2 phase = p + 0.85 * sin(p.yx * 0.83 + vec2(t, -t)) + 0.36 * cos(p.yx * 1.43 - t);
        float d = abs(sin(phase.x) + 0.83 * sin(phase.y));
        float aa = max(fwidth(d), 0.015);
        return 1.0 - smoothstep(0.025, 0.12 + aa, d);
      }
    ` +
      shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `
      #include <lights_fragment_end>
      vec2 p = vSeabedPosition.xz * 2.4;
      float ridge = causticRidge(p, uCausticTime * 0.42);
      float depthFade = exp(-0.055 * max(0.0, ${SURFACE_Y.toFixed(1)} - vSeabedPosition.y));
      float distanceFade = 1.0 - smoothstep(12.0, 32.0, length(vWaterView));
      reflectedLight.indirectDiffuse *= 1.0 + uCausticStrength * depthFade * distanceFade * (4.0 * ridge - 0.45);
    `,
      );
  };
  return (seconds: number, visibility: number) => {
    time.value = seconds;
    strength.value = visibility;
  };
}

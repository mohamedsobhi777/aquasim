import * as THREE from 'three';
import type { WaterCoefficients } from './waterModel';

/**
 * Shared uniform objects. Every patched material references these same
 * objects, so updating a value here updates all materials at once.
 */
export const waterUniforms = {
  uWaterEnabled: { value: 1 },
  uWaterBetaD: { value: new THREE.Vector3() },
  uWaterBetaB: { value: new THREE.Vector3() },
  uWaterBInf: { value: new THREE.Vector3() },
  /** Downwelling daylight transmittance at the camera depth. */
  uWaterAmbient: { value: new THREE.Vector3(1, 1, 1) },
};

/** GLSL declarations and functions; custom ShaderMaterials include this and set vWaterView. */
export const WATER_PARS = /* glsl */ `
uniform float uWaterEnabled;
uniform vec3 uWaterBetaD;
uniform vec3 uWaterBetaB;
uniform vec3 uWaterBInf;
uniform vec3 uWaterAmbient;
varying vec3 vWaterView;

// I = J exp(-betaD z) + Binf (1 - exp(-betaB z)), z = distance to the camera.
vec3 applyWater( vec3 radiance, vec3 viewPos ) {
  float z = length( viewPos );
  vec3 direct = radiance * exp( -uWaterBetaD * z );
  vec3 veil = uWaterBInf * ( 1.0 - exp( -uWaterBetaB * z ) );
  return mix( radiance, direct + veil, uWaterEnabled );
}
`;

/** Adds underwater image formation to a built-in three.js material. Returns the material. */
export function patchUnderwater<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms);
    shader.vertexShader =
      'varying vec3 vWaterView;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n\tvWaterView = mvPosition.xyz;',
      );
    shader.fragmentShader =
      WATER_PARS +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\n\tgl_FragColor.rgb = applyWater( gl_FragColor.rgb, vWaterView );',
      );
  };
  material.customProgramCacheKey = () => 'aquasim-water';
  return material;
}

export function setWaterCoefficients(c: WaterCoefficients, enabled: boolean): void {
  waterUniforms.uWaterBetaD.value.set(...c.betaD);
  waterUniforms.uWaterBetaB.value.set(...c.betaB);
  waterUniforms.uWaterBInf.value.set(...c.bInf);
  waterUniforms.uWaterAmbient.value.set(...c.ambient);
  waterUniforms.uWaterEnabled.value = enabled ? 1 : 0;
}

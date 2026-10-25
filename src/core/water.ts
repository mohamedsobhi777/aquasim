import * as THREE from 'three';
import type { VertexDeformation } from './labelPasses';
import type { WaterCoefficients } from './waterModel';

/** Number of artificial lamps whose in-water scattering is modelled. */
export const MAX_LAMPS = 2;
const LAMP_MARCH_STEPS = 16;
/** Beyond this range the lamp in-scatter contribution is negligible. */
const LAMP_MAX_MARCH = 40;
/**
 * Phase-function value for light scattered back toward a camera next to the
 * lamp (per steradian). Ocean water scatters mostly forward, so backscatter is
 * well below the isotropic 1/(4*pi) ~= 0.08.
 */
const BACKSCATTER_PHASE = 0.025;

/**
 * Bound in place of a lamp shadow map that does not exist yet. three's own
 * fallback for sampler2DShadow arrays lacks a compare mode, which WebGL
 * rejects, so the placeholder must be a compare-mode depth texture.
 */
const NO_SHADOW_MAP = new THREE.DepthTexture(1, 1);
NO_SHADOW_MAP.compareFunction = THREE.LessEqualCompare;
// Version 0 textures are never uploaded, which would leave the unit empty.
NO_SHADOW_MAP.needsUpdate = true;

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
  uWaterScatter: { value: new THREE.Vector3() },
  uLampPosV: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) },
  uLampDirV: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3(0, 0, -1)) },
  uLampColor: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) },
  uLampConeCos: { value: new Array<number>(MAX_LAMPS).fill(1) },
  uLampPenumbraCos: { value: new Array<number>(MAX_LAMPS).fill(1) },
  uLampScatter: { value: 1 },
  /** Lamp shadow maps (compare-mode depth textures) and view-space -> shadow-map matrices. */
  uLampShadowMap: { value: new Array<THREE.Texture>(MAX_LAMPS).fill(NO_SHADOW_MAP) },
  uLampShadowMatrix: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Matrix4()) },
  uLampShadowOn: { value: new Array<number>(MAX_LAMPS).fill(0) },
  /** 1 = beams are shadowed by structures (volumetric shadows), 0 = unshadowed beams. */
  uBeamShadows: { value: 1 },
};

/** Depth-compare bias for shadow lookups in the water volume. */
const SHADOW_BIAS = 0.0015;

/** GLSL declarations and functions; custom ShaderMaterials include this and set vWaterView. */
export const WATER_PARS = /* glsl */ `
#define WATER_LAMPS ${MAX_LAMPS}
#define WATER_LAMP_STEPS ${LAMP_MARCH_STEPS}
#define WATER_LAMP_MAX_MARCH ${LAMP_MAX_MARCH}.0
#define WATER_BACKSCATTER_PHASE ${BACKSCATTER_PHASE}
uniform float uWaterEnabled;
uniform vec3 uWaterBetaD;
uniform vec3 uWaterBetaB;
uniform vec3 uWaterBInf;
uniform vec3 uWaterAmbient;
uniform vec3 uWaterScatter;
uniform vec3 uLampPosV[WATER_LAMPS];
uniform vec3 uLampDirV[WATER_LAMPS];
uniform vec3 uLampColor[WATER_LAMPS];
uniform float uLampConeCos[WATER_LAMPS];
uniform float uLampPenumbraCos[WATER_LAMPS];
uniform float uLampScatter;
uniform sampler2DShadow uLampShadowMap[WATER_LAMPS];
uniform mat4 uLampShadowMatrix[WATER_LAMPS];
uniform float uLampShadowOn[WATER_LAMPS];
uniform float uBeamShadows;
varying vec3 vWaterView;

// 1 if the lamp sees this view-space point, 0 if a shadow caster blocks it.
// Sampler arrays need constant indices in GLSL ES 3.0, hence the branch.
float lampVisibility( int l, vec3 viewPos ) {
  if ( uLampShadowOn[ l ] < 0.5 ) return 1.0;
  vec4 c = uLampShadowMatrix[ l ] * vec4( viewPos, 1.0 );
  if ( c.w <= 0.0 ) return 1.0;
  c.xyz /= c.w;
  if ( any( lessThan( c.xyz, vec3( 0.0 ) ) ) || any( greaterThan( c.xyz, vec3( 1.0 ) ) ) ) return 1.0;
  vec3 coord = vec3( c.xy, c.z - ${SHADOW_BIAS} );
  return l == 0 ? texture( uLampShadowMap[ 0 ], coord ) : texture( uLampShadowMap[ 1 ], coord );
}

// Single-scattering of the robot's lamps along the view ray (view space,
// camera at the origin): scattering coefficient b, beam attenuation betaD on
// both legs (lamp -> sample -> camera). Samples are spaced quadratically,
// denser near the camera where the beam is brightest.
vec3 waterLampInscatter( vec3 viewPos ) {
  float range = min( length( viewPos ), WATER_LAMP_MAX_MARCH );
  vec3 dir = normalize( viewPos );
  vec3 total = vec3( 0.0 );
  for ( int l = 0; l < WATER_LAMPS; l ++ ) {
    if ( dot( uLampColor[ l ], uLampColor[ l ] ) <= 0.0 ) continue;
    vec3 sum = vec3( 0.0 );
    float prev = 0.0;
    for ( int i = 1; i <= WATER_LAMP_STEPS; i ++ ) {
      float f = float( i ) / float( WATER_LAMP_STEPS );
      float t = range * f * f;
      float dt = t - prev;
      prev = t;
      vec3 toSample = dir * t - uLampPosV[ l ];
      float r = length( toSample );
      float cosAngle = dot( toSample / max( r, 1e-4 ), uLampDirV[ l ] );
      float cone = smoothstep( uLampConeCos[ l ], uLampPenumbraCos[ l ], cosAngle );
      if ( cone > 0.0 && uBeamShadows > 0.5 ) cone *= lampVisibility( l, dir * t );
      // The 0.5 m^2 term keeps the near-lamp singularity finite (lamp housing size).
      sum += cone * exp( -uWaterBetaD * ( r + t ) ) / ( r * r + 0.5 ) * dt;
    }
    total += sum * uLampColor[ l ];
  }
  return total * uWaterScatter * WATER_BACKSCATTER_PHASE * uLampScatter;
}

// Lamp irradiance arriving at a point in the water (view space), attenuated
// along the lamp-to-point path. Used to light particles and sediment.
vec3 waterLampIrradiance( vec3 viewPos ) {
  vec3 light = vec3( 0.0 );
  for ( int l = 0; l < WATER_LAMPS; l ++ ) {
    vec3 toP = viewPos - uLampPosV[ l ];
    float r = length( toP );
    float cone = smoothstep( uLampConeCos[ l ], uLampPenumbraCos[ l ], dot( toP / max( r, 1e-4 ), uLampDirV[ l ] ) );
    if ( cone > 0.0 && uBeamShadows > 0.5 ) cone *= lampVisibility( l, viewPos );
    light += uLampColor[ l ] * cone * exp( -uWaterBetaD * r ) / ( r * r + 0.05 );
  }
  return light;
}

// Attenuation and veiling light only, for semi-transparent media whose
// background already carries the lamp in-scatter.
vec3 applyWaterNoInscatter( vec3 radiance, vec3 viewPos ) {
  float z = length( viewPos );
  vec3 direct = radiance * exp( -uWaterBetaD * z );
  vec3 veil = uWaterBInf * ( 1.0 - exp( -uWaterBetaB * z ) );
  return mix( radiance, direct + veil, uWaterEnabled );
}

vec3 applyWater( vec3 radiance, vec3 viewPos ) {
  float z = length( viewPos );
  vec3 direct = radiance * exp( -uWaterBetaD * z );
  vec3 veil = uWaterBInf * ( 1.0 - exp( -uWaterBetaB * z ) );
  return mix( radiance, direct + veil + waterLampInscatter( viewPos ), uWaterEnabled );
}
`;

// Light reaching a surface from a point/spot lamp is also attenuated along the
// lamp-to-surface path, not only along the surface-to-camera path.
const LIGHTS_PARS_PATCHED = THREE.ShaderChunk.lights_pars_begin.replace(
  /(light\.color \*= getDistanceAttenuation\( lightDistance, (?:point|spot)Light\.distance, (?:point|spot)Light\.decay \);)/g,
  '$1\n\t\tlight.color *= exp( -uWaterBetaD * lightDistance * uWaterEnabled );',
);

if (LIGHTS_PARS_PATCHED === THREE.ShaderChunk.lights_pars_begin) {
  throw new Error('water.ts: lights_pars_begin patch target not found (three.js version changed?)');
}

/**
 * Adds underwater image formation to a built-in three.js material. An optional
 * vertex deformation is injected after `begin_vertex`; register the same one on
 * the mesh with `setVertexDeformation` so label passes match. Returns the material.
 */
export function patchUnderwater<T extends THREE.Material>(material: T, deformation?: VertexDeformation): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms, deformation?.uniforms ?? {});
    shader.vertexShader =
      'varying vec3 vWaterView;\n' +
      (deformation?.pars ?? '') +
      '\n' +
      shader.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${deformation?.body ?? ''}`)
        .replace('#include <project_vertex>', '#include <project_vertex>\n\tvWaterView = mvPosition.xyz;');
    shader.fragmentShader =
      WATER_PARS +
      shader.fragmentShader
        .replace('#include <lights_pars_begin>', LIGHTS_PARS_PATCHED)
        .replace(
          '#include <opaque_fragment>',
          '#include <opaque_fragment>\n\tgl_FragColor.rgb = applyWater( gl_FragColor.rgb, vWaterView );',
        );
  };
  material.customProgramCacheKey = () => `aquasim-water:${deformation?.body ?? ''}`;
  return material;
}

export function setWaterCoefficients(c: WaterCoefficients, enabled: boolean): void {
  waterUniforms.uWaterBetaD.value.set(...c.betaD);
  waterUniforms.uWaterBetaB.value.set(...c.betaB);
  waterUniforms.uWaterBInf.value.set(...c.bInf);
  waterUniforms.uWaterAmbient.value.set(...c.ambient);
  waterUniforms.uWaterScatter.value.set(...c.scatter);
  waterUniforms.uWaterEnabled.value = enabled ? 1 : 0;
}

const tmpPos = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpShadow = new THREE.Matrix4();

/** Copies lamp state into view space for the in-scatter march. Call once per frame after the camera moves. */
export function syncLamps(camera: THREE.Camera, lamps: readonly THREE.SpotLight[]): void {
  const view = camera.matrixWorldInverse;
  for (let i = 0; i < MAX_LAMPS; i++) {
    const lamp = lamps[i];
    const color = waterUniforms.uLampColor.value[i];
    if (!lamp || !lamp.visible) {
      color.set(0, 0, 0);
      continue;
    }
    lamp.getWorldPosition(tmpPos);
    lamp.target.getWorldPosition(tmpTarget);
    tmpPos.applyMatrix4(view);
    tmpTarget.applyMatrix4(view);
    waterUniforms.uLampPosV.value[i].copy(tmpPos);
    waterUniforms.uLampDirV.value[i].subVectors(tmpTarget, tmpPos).normalize();
    color.set(lamp.color.r, lamp.color.g, lamp.color.b).multiplyScalar(lamp.intensity);
    waterUniforms.uLampConeCos.value[i] = Math.cos(lamp.angle);
    waterUniforms.uLampPenumbraCos.value[i] = Math.cos(lamp.angle * (1 - lamp.penumbra));

    // The renderer refreshes shadow matrices during render; refresh them now so
    // the water march uses this frame's lamp pose rather than the previous one.
    const shadowTexture = lamp.castShadow ? (lamp.shadow.map?.depthTexture ?? null) : null;
    waterUniforms.uLampShadowMap.value[i] = shadowTexture ?? NO_SHADOW_MAP;
    waterUniforms.uLampShadowOn.value[i] = shadowTexture ? 1 : 0;
    if (shadowTexture) {
      lamp.shadow.updateMatrices(lamp);
      waterUniforms.uLampShadowMatrix.value[i].multiplyMatrices(lamp.shadow.matrix, tmpShadow.copy(camera.matrixWorld));
    }
  }
}

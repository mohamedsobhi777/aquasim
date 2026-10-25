import * as THREE from 'three';
import { createRng } from './rng';
import { TRACK_INTERVAL, TRACK_WINDOW, type TrackSample } from './robotTrack';
import { excludeFromLabels } from './semantics';
import { WATER_PARS, waterUniforms } from './water';

/** Distance from the robot origin (camera) down to the bottom of the skids, metres. */
const SKID_DEPTH = 0.65;
/** Thruster downwash lifts sediment fully below this skid altitude and not at all above the next. */
const EMIT_FULL_ALTITUDE = 0.3;
const EMIT_NONE_ALTITUDE = 1.8;
/** Speed at which the thrusters run hard enough for full emission, m/s. */
const FULL_THRUST_SPEED = 0.6;
const MIN_EMISSION = 0.02;
export const PUFF_LIFE = 25;
/** Two puffs per track sample, one under each side of the vehicle. */
const MAX_PUFFS = 2 * (Math.round(TRACK_WINDOW / TRACK_INTERVAL) + 1);

export interface Puff {
  center: THREE.Vector3;
  radius: number;
  opacity: number;
  seed: number;
}

/** How much sediment the thrusters lift at one track sample (0 = none, about 1 = skids on the bottom at speed). */
export function emission(sample: TrackSample, strength: number): number {
  const skidAltitude = sample.altitude - SKID_DEPTH;
  const near = 1 - THREE.MathUtils.smoothstep(skidAltitude, EMIT_FULL_ALTITUDE, EMIT_NONE_ALTITUDE);
  const thrust = 0.3 + 0.7 * Math.min(1, sample.velocity.length() / FULL_THRUST_SPEED);
  return strength * near * thrust;
}

/** Deterministic [0, 1) hash of an integer. */
function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * State of the sediment puff lifted at `sample` on one side of the vehicle, at
 * time `now`: it is thrown outward by the jets, billows up, spreads, drifts
 * with the current, then thins out and settles. Null when there is none.
 */
export function puffAt(
  sample: TrackSample,
  side: -1 | 1,
  now: number,
  strength: number,
  current: THREE.Vector3,
  groundHeight: (x: number, z: number) => number,
): Puff | null {
  const age = now - sample.t;
  if (age < 0 || age > PUFF_LIFE) return null;
  const e = emission(sample, strength);
  if (e < MIN_EMISSION) return null;

  const id = Math.round(sample.t / TRACK_INTERVAL) * 2 + (side > 0 ? 1 : 0);
  const [h1, h2, h3] = [hash(id), hash(id + 7919), hash(id + 15887)];
  const forward = new THREE.Vector3(-Math.sin(sample.yaw), 0, -Math.cos(sample.yaw));
  const right = new THREE.Vector3(Math.cos(sample.yaw), 0, -Math.sin(sample.yaw));
  const outward = right
    .clone()
    .multiplyScalar(side)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), (h1 - 0.5) * 1.2);

  const spread = (0.6 + 0.8 * e) * (1 - Math.exp(-age / 1.2));
  const center = sample.position
    .clone()
    .addScaledVector(right, side * 0.35)
    .addScaledVector(forward, -0.7)
    .addScaledVector(outward, spread)
    .addScaledVector(current, age);
  const radius = Math.min(3.5, 0.25 + (0.5 + 0.7 * h2) * Math.sqrt(age) * (0.6 + 0.6 * e));
  const rise = (0.25 + 0.9 * e * h3) * (1 - Math.exp(-age / 1.5)) - 0.015 * Math.max(0, age - 6);
  center.y = groundHeight(center.x, center.z) + Math.max(radius * 0.45, rise + radius * 0.3);

  const opacity = Math.min(0.6, e * 0.55) * (1 - Math.exp(-age / 0.35)) * Math.exp(-age / 8) * THREE.MathUtils.clamp(0.7 / radius, 0.15, 1);
  return opacity < 0.004 ? null : { center, radius, opacity, seed: h1 };
}

/** Fraction of lamp irradiance scattered back toward the camera, per steradian. */
const SILT_LAMP_PHASE = 0.08;
/**
 * Puff quads are subdivided and lit per vertex: silt is soft, and per-pixel
 * lamp lighting (with beam-shadow lookups) over many overlapping puffs was
 * the most expensive part of a frame inside a plume.
 */
const PUFF_SEGMENTS = 8;

/** Tileable value-noise texture: NOISE_CELLS lattice cells across NOISE_SIZE pixels. */
const NOISE_SIZE = 64;
const NOISE_CELLS = 8;

function makeNoiseTexture(seed: number): THREE.DataTexture {
  const rng = createRng(seed);
  const lattice = Float32Array.from({ length: NOISE_CELLS * NOISE_CELLS }, () => rng.next());
  const at = (i: number, j: number): number => lattice[(j % NOISE_CELLS) * NOISE_CELLS + (i % NOISE_CELLS)];
  const fade = (t: number): number => t * t * (3 - 2 * t);
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE);
  const step = NOISE_SIZE / NOISE_CELLS;
  for (let y = 0; y < NOISE_SIZE; y++) {
    for (let x = 0; x < NOISE_SIZE; x++) {
      const i = Math.floor(x / step);
      const j = Math.floor(y / step);
      const u = fade((x % step) / step);
      const v = fade((y % step) / step);
      const value = THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(i, j), at(i + 1, j), u), THREE.MathUtils.lerp(at(i, j + 1), at(i + 1, j + 1), u), v);
      data[y * NOISE_SIZE + x] = Math.round(value * 255);
    }
  }
  const texture = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/*
 * Inside a plume many large puffs overlap on screen, so the fragment shader
 * is kept minimal: lighting and water attenuation are per vertex on a
 * subdivided quad (silt is soft), billows come from a noise texture, and
 * invisible puffs are dropped before rasterisation.
 */
const vertexShader = /* glsl */ `
${WATER_PARS}
#define SILT_LAMP_PHASE ${SILT_LAMP_PHASE}
attribute vec4 iCenter;
attribute vec2 iParams;
varying vec3 vLight;
varying vec3 vTransmit;
varying vec3 vVeil;
varying vec2 vUv;
varying float vOpacity;
varying float vSeed;

void main() {
  float radius = iCenter.w;
  float angle = iParams.y * 6.2831853;
  vec2 corner = mat2( cos( angle ), sin( angle ), -sin( angle ), cos( angle ) ) * position.xy;
  vec4 mvPosition = viewMatrix * vec4( iCenter.xyz, 1.0 );
  // Fade puffs the camera is inside of, so a flat sprite never fills the view.
  vOpacity = iParams.x * smoothstep( 0.5 * radius, 1.6 * radius, -mvPosition.z );
  if ( vOpacity < 0.002 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  mvPosition.xy += corner * radius * 2.0;
  vWaterView = mvPosition.xyz;
  // Ambient light is diffuse; lamp light reaches the camera by scattering
  // back off the silt, which is much weaker than a matte surface would give.
  vLight = uWaterAmbient * 0.7 / 3.14159 + waterLampIrradiance( mvPosition.xyz ) * SILT_LAMP_PHASE;
  // applyWaterNoInscatter( radiance ) == radiance * vTransmit + vVeil
  float z = length( mvPosition.xyz );
  vTransmit = mix( vec3( 1.0 ), exp( -uWaterBetaD * z ), uWaterEnabled );
  vVeil = uWaterBInf * ( 1.0 - exp( -uWaterBetaB * z ) ) * uWaterEnabled;
  vUv = position.xy;
  vSeed = iParams.y;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSedimentColor;
uniform float uTime;
uniform sampler2D uNoise;
varying vec3 vLight;
varying vec3 vTransmit;
varying vec3 vVeil;
varying vec2 vUv;
varying float vOpacity;
varying float vSeed;

void main() {
  // Density is zero beyond r = 1.4 whatever the noise, so skip the lookups there.
  float r = length( vUv ) * 2.0;
  if ( r > 1.4 ) discard;
  // About three noise cells across a puff, two octaves, slowly churning.
  vec2 p = vUv * ${(3 / NOISE_CELLS).toFixed(4)} + vSeed * 4.3 + vec2( uTime * 0.005, -uTime * 0.004 );
  float billow = 0.65 * texture2D( uNoise, p ).r + 0.35 * texture2D( uNoise, p * 2.1 + 0.37 ).r;
  float alpha = smoothstep( 1.0, 0.2, r + ( billow - 0.5 ) * 0.8 ) * vOpacity;
  if ( alpha < 0.003 ) discard;
  vec3 radiance = uSedimentColor * ( 0.75 + 0.5 * billow ) * vLight;
  gl_FragColor = vec4( radiance * vTransmit + vVeil, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Sediment lifted off the seabed by the thrusters when the robot flies low,
 * drawn as soft camera-facing puffs. Visual only: it hides structure in the
 * RGB image while the label passes still see the structure behind it.
 */
export class SedimentPlumes {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly centers: THREE.InstancedBufferAttribute;
  private readonly params: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private count = 0;

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1, PUFF_SEGMENTS, PUFF_SEGMENTS);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.centers = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iCenter', this.centers);
    this.geometry.setAttribute('iParams', this.params);
    this.geometry.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...waterUniforms,
        uSedimentColor: { value: new THREE.Color(0xb3a68a) },
        uTime: { value: 0 },
        uNoise: { value: makeNoiseTexture(0x5117) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'sediment-plumes';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    excludeFromLabels(this.mesh);
  }

  /** Number of puffs drawn in the last sync. */
  get puffCount(): number {
    return this.count;
  }

  sync(
    now: number,
    track: readonly TrackSample[],
    strength: number,
    current: THREE.Vector3,
    groundHeight: (x: number, z: number) => number,
    cameraPosition: THREE.Vector3,
  ): void {
    const puffs: Puff[] = [];
    if (strength > 0) {
      for (const sample of track) {
        for (const side of [-1, 1] as const) {
          const puff = puffAt(sample, side, now, strength, current, groundHeight);
          if (puff) puffs.push(puff);
        }
      }
    }
    // Back to front, so overlapping translucent puffs blend correctly.
    const distance = (puff: Puff): number => puff.center.distanceToSquared(cameraPosition);
    puffs.sort((a, b) => distance(b) - distance(a));
    this.count = Math.min(puffs.length, MAX_PUFFS);
    for (let i = 0; i < this.count; i++) {
      const { center, radius, opacity, seed } = puffs[i];
      this.centers.setXYZW(i, center.x, center.y, center.z, radius);
      this.params.setXY(i, opacity, seed);
    }
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    this.centers.needsUpdate = true;
    this.params.needsUpdate = true;
    this.material.uniforms.uTime.value = now;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.material.uniforms.uNoise.value as THREE.Texture).dispose();
    this.material.dispose();
  }
}

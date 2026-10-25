import * as THREE from 'three';
import { createRng } from './rng';
import { TRACK_INTERVAL, type TrackSample } from './robotTrack';
import { excludeFromLabels } from './semantics';
import { WATER_PARS, waterUniforms } from './water';

const MAX_PARTICLES = 40000;
/** Track samples that shape the wake (the last WAKE_SAMPLES * TRACK_INTERVAL seconds). */
export const WAKE_SAMPLES = 16;

const vertexShader = /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uDrift;
uniform float uBox;
uniform float uTime;
uniform float uPixelScale;
uniform vec4 uWakePos[${WAKE_SAMPLES}];
uniform vec4 uWakeVel[${WAKE_SAMPLES}];
attribute vec4 seed;
varying vec3 vWaterView;
varying float vFade;
varying float vAlbedo;

void main() {
  float h = uBox * 0.5;
  vec3 wobble = 0.04 * vec3( sin( uTime * 0.7 + seed.x * 40.0 ), sin( uTime * 0.5 + seed.y * 40.0 ), cos( uTime * 0.6 + seed.z * 40.0 ) );
  // Wrap the particle field around the camera so it never runs out.
  vec3 world = uCenter - h + mod( position + uDrift + wobble - ( uCenter - h ), uBox );
  // Thruster wake: water behind the robot's recent path is pushed back
  // along its motion and outward, and relaxes as the samples age.
  // xyz = sample position / velocity, w = age (s) / weight.
  vec3 wake = vec3( 0.0 );
  for ( int k = 0; k < ${WAKE_SAMPLES}; k ++ ) {
    float weight = uWakeVel[ k ].w;
    if ( weight <= 0.0 ) continue;
    float age = uWakePos[ k ].w;
    vec3 d = world - uWakePos[ k ].xyz;
    float sigma = 0.6 + 0.5 * age;
    float g = exp( -dot( d, d ) / ( sigma * sigma ) ) * weight * ( 1.0 - exp( -age / 0.4 ) );
    vec3 v = uWakeVel[ k ].xyz;
    wake += g * ( -0.12 * v + 0.06 * length( v ) * d / max( length( d ), 1e-3 ) );
  }
  world += wake;
  vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
  vWaterView = mvPosition.xyz;
  float dist = length( mvPosition.xyz );
  float edge = length( world - uCenter ) / h;
  vFade = smoothstep( 0.12, 0.4, dist ) * ( 1.0 - smoothstep( 0.7, 1.0, edge ) );
  vAlbedo = 0.35 + 0.65 * seed.w;
  float size = mix( 0.004, 0.02, seed.w * seed.w * seed.w );
  gl_PointSize = max( 1.0, size * uPixelScale / max( -mvPosition.z, 0.05 ) );
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */ `
${WATER_PARS}
uniform vec3 uParticleColor;
varying float vFade;
varying float vAlbedo;


void main() {
  float r = length( gl_PointCoord - 0.5 );
  float alpha = smoothstep( 0.5, 0.15, r ) * vFade;
  if ( alpha < 0.01 ) discard;
  vec3 radiance = uParticleColor * vAlbedo * ( waterLampIrradiance( vWaterView ) + uWaterAmbient * 0.6 ) / 3.14159;
  gl_FragColor = vec4( applyWater( radiance, vWaterView ), alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Suspended matter ("marine snow" / silt) drifting with the current, visual only (excluded from labels). */
export class SuspendedParticles {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly drift = new THREE.Vector3();

  constructor(seed: number, box = 14) {
    const rng = createRng(seed ^ 0x5eed);
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const seeds = new Float32Array(MAX_PARTICLES * 4);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      positions.set([rng.range(0, box), rng.range(0, box), rng.range(0, box)], i * 3);
      seeds.set([rng.next(), rng.next(), rng.next(), rng.next()], i * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...waterUniforms,
        uCenter: { value: new THREE.Vector3() },
        uDrift: { value: this.drift },
        uBox: { value: box },
        uTime: { value: 0 },
        uPixelScale: { value: 800 },
        uParticleColor: { value: new THREE.Color(0xd8d2c0) },
        uWakePos: { value: Array.from({ length: WAKE_SAMPLES }, () => new THREE.Vector4()) },
        uWakeVel: { value: Array.from({ length: WAKE_SAMPLES }, () => new THREE.Vector4()) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.name = 'suspended-particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    excludeFromLabels(this.points);
    this.setCount(6000);
  }

  setCount(count: number): void {
    this.points.geometry.setDrawRange(0, THREE.MathUtils.clamp(Math.round(count), 0, MAX_PARTICLES));
    this.points.visible = count > 0;
  }

  /**
   * Positions are a pure function of simulation time, so replaying a
   * trajectory reproduces the same particles. `current` is the water velocity
   * in m/s; `pixelScale` is image height / (2 tan(fov/2)).
   */
  sync(time: number, cameraPosition: THREE.Vector3, current: THREE.Vector3, pixelScale: number): void {
    const box = this.material.uniforms.uBox.value as number;
    const wrap = (v: number): number => ((v % box) + box) % box;
    this.drift.set(wrap(current.x * time), wrap(current.y * time), wrap(current.z * time));
    this.material.uniforms.uCenter.value.copy(cameraPosition);
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uPixelScale.value = pixelScale;
  }

  /** Feeds the most recent track samples to the wake; `enabled` false clears it. */
  setWake(now: number, track: readonly TrackSample[], enabled: boolean): void {
    const positions = this.material.uniforms.uWakePos.value as THREE.Vector4[];
    const velocities = this.material.uniforms.uWakeVel.value as THREE.Vector4[];
    const span = WAKE_SAMPLES * TRACK_INTERVAL;
    for (let k = 0; k < WAKE_SAMPLES; k++) {
      const sample = enabled ? track[track.length - 1 - k] : undefined;
      const age = sample ? now - sample.t : span;
      if (!sample || age < 0 || age >= span) {
        velocities[k].set(0, 0, 0, 0);
        continue;
      }
      positions[k].set(sample.position.x, sample.position.y, sample.position.z, age);
      velocities[k].set(sample.velocity.x, sample.velocity.y, sample.velocity.z, (1 - age / span) ** 2);
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

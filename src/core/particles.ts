import * as THREE from 'three';
import { createRng } from './rng';
import { WATER_PARS, waterUniforms } from './water';

const MAX_PARTICLES = 40000;

const vertexShader = /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uDrift;
uniform float uBox;
uniform float uTime;
uniform float uPixelScale;
attribute vec4 seed;
varying vec3 vWaterView;
varying float vFade;
varying float vAlbedo;

void main() {
  float h = uBox * 0.5;
  vec3 wobble = 0.04 * vec3( sin( uTime * 0.7 + seed.x * 40.0 ), sin( uTime * 0.5 + seed.y * 40.0 ), cos( uTime * 0.6 + seed.z * 40.0 ) );
  // Wrap the particle field around the camera so it never runs out.
  vec3 world = uCenter - h + mod( position + uDrift + wobble - ( uCenter - h ), uBox );
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
  vec3 radiance = uParticleColor * vAlbedo * uWaterAmbient * 0.6 / 3.14159;
  gl_FragColor = vec4( applyWater( radiance, vWaterView ), alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Suspended matter ("marine snow" / silt) drifting with the current. */
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
    this.setCount(6000);
  }

  setCount(count: number): void {
    this.points.geometry.setDrawRange(0, THREE.MathUtils.clamp(Math.round(count), 0, MAX_PARTICLES));
    this.points.visible = count > 0;
  }

  /**
   * Positions are a pure function of simulation time. `current` is the water velocity
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

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

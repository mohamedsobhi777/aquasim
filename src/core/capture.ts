import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { extractChannel, flipRows } from './encoders';
import type { LabelPasses } from './labelPasses';

export interface CaptureSize {
  width: number;
  height: number;
}

/** Raw, top-down pixel buffers for one frame; every pass shares camera and simulation time. */
export interface CapturedFrame {
  width: number;
  height: number;
  /** sRGB, tone-mapped RGBA8 - matches what the viewport shows. */
  rgb: Uint8Array;
  /** Planar view-space depth in metres (z along the optical axis); 0 where no surface. */
  depth: Float32Array;
  /** RGBA8 id mask: R = class id, G/B = instance id (big-endian 16 bit). */
  semantic: Uint8Array;
  /** Camera-to-world matrix (three.js camera frame), column-major. */
  cameraToWorld: number[];
  vfov: number;
}

const RGB_MSAA_SAMPLES = 4;

export interface RenderTiming {
  /** Median wall time of one RGB render with the GPU finished (pipeline drained by a 1-pixel read). */
  ms: number;
  /** Triangles and draw calls submitted, shadow-map passes included. */
  triangles: number;
  drawCalls: number;
}

/**
 * Renders RGB, depth and semantic passes off-screen at a fixed resolution.
 * The caller must freeze simulation time before calling `capture`.
 */
export class FrameCapturer {
  private readonly outputPass = new OutputPass();
  private hdr?: THREE.WebGLRenderTarget;
  private ldr?: THREE.WebGLRenderTarget;
  private depthTarget?: THREE.WebGLRenderTarget;
  private maskTarget?: THREE.WebGLRenderTarget;
  private size: CaptureSize = { width: 0, height: 0 };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly passes: LabelPasses,
  ) {}

  private ensureTargets({ width, height }: CaptureSize): void {
    if (this.size.width === width && this.size.height === height) return;
    this.disposeTargets();
    this.hdr = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: RGB_MSAA_SAMPLES });
    this.ldr = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType });
    // Label targets have no MSAA: blending ids or depths across edges would invent values.
    this.depthTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.maskTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.size = { width, height };
  }

  /** Runs `body` with the camera set to the capture aspect, restoring renderer and camera state afterwards. */
  private withTargets<T>(camera: THREE.PerspectiveCamera, size: CaptureSize, body: () => T): T {
    const { renderer } = this;
    this.ensureTargets(size);
    const previousAspect = camera.aspect;
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    try {
      return body();
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousClear, previousAlpha);
      camera.aspect = previousAspect;
      camera.updateProjectionMatrix();
    }
  }

  /** Renders the RGB image into the HDR target and tone-maps it into the LDR target. */
  private renderRgb(scene: THREE.Scene, camera: THREE.PerspectiveCamera): { triangles: number; drawCalls: number } {
    const { renderer } = this;
    renderer.setRenderTarget(this.hdr!);
    renderer.clear();
    renderer.render(scene, camera);
    // Read before the output pass, whose own render call resets the counters.
    const { triangles, calls } = renderer.info.render;
    // Same tone mapping and sRGB encoding the renderer applies on screen.
    this.outputPass.render(renderer, this.ldr!, this.hdr!, 0, false);
    return { triangles, drawCalls: calls };
  }

  /** Times the RGB render `repeats` times at `size`; the caller must freeze simulation time. */
  timeRgb(scene: THREE.Scene, camera: THREE.PerspectiveCamera, size: CaptureSize, repeats: number): RenderTiming {
    return this.withTargets(camera, size, () => {
      const pixel = new Uint8Array(4);
      const times: number[] = [];
      let geometry = { triangles: 0, drawCalls: 0 };
      for (let i = 0; i < Math.max(1, repeats); i++) {
        const start = performance.now();
        geometry = this.renderRgb(scene, camera);
        this.renderer.readRenderTargetPixels(this.ldr!, 0, 0, 1, 1, pixel);
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return { ms: times[Math.floor(times.length / 2)], ...geometry };
    });
  }

  capture(scene: THREE.Scene, camera: THREE.PerspectiveCamera, size: CaptureSize): CapturedFrame {
    const { renderer } = this;
    const { width, height } = size;
    return this.withTargets(camera, size, () => {
      const ldr = this.ldr!;
      const depthTarget = this.depthTarget!;
      const maskTarget = this.maskTarget!;
      this.renderRgb(scene, camera);
      const rgb = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(ldr, 0, 0, width, height, rgb);

      renderer.setClearColor(0x000000, 0);
      const depthRgba = new Float32Array(width * height * 4);
      this.passes.withPass(scene, 'depth', false, () => {
        renderer.setRenderTarget(depthTarget);
        renderer.clear();
        renderer.render(scene, camera);
      });
      renderer.readRenderTargetPixels(depthTarget, 0, 0, width, height, depthRgba);

      const semantic = new Uint8Array(width * height * 4);
      this.passes.withPass(scene, 'semantic', false, () => {
        renderer.setRenderTarget(maskTarget);
        renderer.clear();
        renderer.render(scene, camera);
      });
      renderer.readRenderTargetPixels(maskTarget, 0, 0, width, height, semantic);

      return {
        width,
        height,
        rgb: flipRows(rgb, width, height, 4),
        depth: flipRows(extractChannel(depthRgba, 4, 0), width, height, 1),
        semantic: flipRows(semantic, width, height, 4),
        cameraToWorld: camera.matrixWorld.toArray(),
        vfov: camera.fov,
      };
    });
  }

  private disposeTargets(): void {
    [this.hdr, this.ldr, this.depthTarget, this.maskTarget].forEach((t) => t?.dispose());
  }

  dispose(): void {
    this.disposeTargets();
    this.outputPass.dispose();
  }
}

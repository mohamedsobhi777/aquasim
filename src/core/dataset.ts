import { zipSync } from 'fflate';
import type { CapturedFrame } from './capture';
import { glToCvCameraToWorld, intrinsicsFromVerticalFov } from './cameraModel';
import { encodeJson, encodeNpyFloat32, encodePng } from './encoders';
import type { InstanceRecord } from './labelPasses';
import type { SemanticClass } from './semantics';

/** Where captured files go. */
export interface DatasetSink {
  write(path: string, data: Uint8Array): Promise<void>;
  /** Called once after the last file. */
  finish(): Promise<void>;
}

export interface DatasetManifest {
  scene: string;
  seed: number;
  trajectory: string | null;
  classes: readonly SemanticClass[];
  instances: readonly InstanceRecord[];
  settings: Record<string, unknown>;
}

const CONVENTIONS = {
  rgb: 'rgb/NNNNNN.png - sRGB, tone mapped, as displayed',
  depth:
    'depth/NNNNNN.npy - float32 [H, W], planar z-depth in metres along the optical axis; 0 = no surface (open water)',
  semantic:
    'semantic/NNNNNN.png - R = class id, G*256 + B = instance id; 0 = water. Labels cover opaque scene surfaces only; suspended particles and water are excluded',
  pose: 'meta/NNNNNN.json - cameraToWorld_gl (three.js: x right, y up, looking -z) and cameraToWorld_cv (OpenCV: x right, y down, looking +z), column-major 4x4',
  units: 'metres, seconds (simulation time)',
};

/** Colours a semantic id mask for human inspection. */
function visualiseSemantic(mask: Uint8Array, classes: readonly SemanticClass[]): Uint8Array {
  const palette = new Map(classes.map((c) => [c.id, c.color]));
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 4) {
    const color = palette.get(mask[i]) ?? [0, 0, 0];
    const shade = mask[i] === 0 ? 1 : 0.75 + (0.25 * (((mask[i + 1] * 256 + mask[i + 2]) * 2654435761) % 256)) / 255;
    out[i] = color[0] * shade;
    out[i + 1] = color[1] * shade;
    out[i + 2] = color[2] * shade;
    out[i + 3] = 255;
  }
  return out;
}

function visualiseDepth(depth: Float32Array, scale: number): Uint8Array {
  const out = new Uint8Array(depth.length * 4);
  for (let i = 0; i < depth.length; i++) {
    const v = depth[i] > 0 ? Math.round(255 * Math.exp(-depth[i] / scale)) : 0;
    out.set([v, v, v, 255], i * 4);
  }
  return out;
}

function opaque(rgba: Uint8Array): Uint8Array {
  const out = rgba.slice();
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

export class DatasetWriter {
  private frameCount = 0;

  constructor(
    private readonly sink: DatasetSink,
    private readonly manifest: DatasetManifest,
  ) {}

  get frames(): number {
    return this.frameCount;
  }

  async addFrame(frame: CapturedFrame, simTime: number, extra: Record<string, unknown> = {}): Promise<void> {
    const name = String(this.frameCount).padStart(6, '0');
    const { width, height } = frame;
    const [rgb, semantic, semanticVis, depthVis] = await Promise.all([
      encodePng(opaque(frame.rgb), width, height),
      encodePng(opaque(frame.semantic), width, height),
      encodePng(visualiseSemantic(frame.semantic, this.manifest.classes), width, height),
      encodePng(visualiseDepth(frame.depth, 12), width, height),
    ]);
    const meta = {
      frame: this.frameCount,
      simTime,
      intrinsics: intrinsicsFromVerticalFov(frame.vfov, width, height),
      cameraToWorld_gl: frame.cameraToWorld,
      cameraToWorld_cv: glToCvCameraToWorld(frame.cameraToWorld),
      ...extra,
    };
    await this.sink.write(`rgb/${name}.png`, rgb);
    await this.sink.write(`depth/${name}.npy`, encodeNpyFloat32(frame.depth, [height, width]));
    await this.sink.write(`semantic/${name}.png`, semantic);
    await this.sink.write(`preview/semantic_${name}.png`, semanticVis);
    await this.sink.write(`preview/depth_${name}.png`, depthVis);
    await this.sink.write(`meta/${name}.json`, encodeJson(meta));
    this.frameCount++;
  }

  async finish(): Promise<void> {
    await this.sink.write(
      'dataset.json',
      encodeJson({
        generator: 'AquaSim',
        created: new Date().toISOString(),
        frames: this.frameCount,
        conventions: CONVENTIONS,
        ...this.manifest,
      }),
    );
    await this.sink.finish();
  }
}

/** Collects files in memory and downloads one .zip at the end. */
export class ZipSink implements DatasetSink {
  private readonly files: Record<string, Uint8Array> = {};

  constructor(private readonly filename: string) {}

  async write(path: string, data: Uint8Array): Promise<void> {
    this.files[path] = data;
  }

  async finish(): Promise<void> {
    // PNG and npy payloads compress poorly; store them to keep zipping fast.
    const zipped = zipSync(this.files, { level: 0 });
    const url = URL.createObjectURL(new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: this.filename });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

interface DirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{
    createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
  }>;
}

/** Streams files into a user-chosen folder (File System Access API, Chromium only). */
export class DirectorySink implements DatasetSink {
  private constructor(private readonly root: DirectoryHandle) {}

  static isSupported(): boolean {
    return 'showDirectoryPicker' in window;
  }

  static async pick(folderName: string): Promise<DirectorySink> {
    const host = window as unknown as { showDirectoryPicker(o: { mode: string }): Promise<DirectoryHandle> };
    const parent = await host.showDirectoryPicker({ mode: 'readwrite' });
    return new DirectorySink(await parent.getDirectoryHandle(folderName, { create: true }));
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const parts = path.split('/');
    const fileName = parts.pop()!;
    let dir = this.root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const writable = await (await dir.getFileHandle(fileName, { create: true })).createWritable();
    await writable.write(data);
    await writable.close();
  }

  async finish(): Promise<void> {}
}

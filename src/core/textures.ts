import * as THREE from 'three';
import type { Rng } from './rng';

export interface FoulingStyle {
  base: string;
  /** Blotch colours for marine growth, rust or silt deposits. */
  blotches: readonly string[];
  blotchCount: number;
  /** Fine grain amplitude, 0..1. */
  grain: number;
}

const TEXTURE_SIZE = 256;

/**
 * Procedural tileable surface texture: base colour, soft blotches (wrapped at
 * edges so the texture tiles) and fine grain. Generated per seed so variation
 * is reproducible.
 */
export function makeFoulingTexture(rng: Rng, style: FoulingStyle, repeat: [number, number]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for procedural textures');

  ctx.fillStyle = style.base;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  for (let i = 0; i < style.blotchCount; i++) {
    const x = rng.range(0, TEXTURE_SIZE);
    const y = rng.range(0, TEXTURE_SIZE);
    const radius = rng.range(6, 38);
    ctx.globalAlpha = rng.range(0.12, 0.45);
    ctx.fillStyle = rng.pick(style.blotches);
    for (const dx of [-TEXTURE_SIZE, 0, TEXTURE_SIZE]) {
      for (const dy of [-TEXTURE_SIZE, 0, TEXTURE_SIZE]) {
        const gradient = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
        gradient.addColorStop(0, ctx.fillStyle);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rng.pick(style.blotches);
      }
    }
  }

  ctx.globalAlpha = 1;
  const image = ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (rng.next() - 0.5) * 255 * style.grain;
    image.data[i] += n;
    image.data[i + 1] += n;
    image.data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 4;
  return texture;
}

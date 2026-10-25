/** Returns a vertically flipped copy (WebGL readback is bottom-up). */
export function flipRows<T extends Uint8Array | Float32Array>(data: T, width: number, height: number, channels: number): T {
  const rowLength = width * channels;
  const out = new (data.constructor as { new (n: number): T })(data.length);
  for (let y = 0; y < height; y++) {
    out.set(data.subarray((height - 1 - y) * rowLength, (height - y) * rowLength), y * rowLength);
  }
  return out;
}

/** Extracts one channel from interleaved pixel data. */
export function extractChannel(data: Float32Array, channels: number, channel: number): Float32Array {
  const out = new Float32Array(data.length / channels);
  for (let i = 0; i < out.length; i++) out[i] = data[i * channels + channel];
  return out;
}

/** Encodes a float32 array as a NumPy .npy (v1.0) file, readable with numpy.load. */
export function encodeNpyFloat32(data: Float32Array, shape: readonly number[]): Uint8Array {
  const expected = shape.reduce((a, b) => a * b, 1);
  if (expected !== data.length) throw new Error(`npy shape ${shape.join('x')} does not match ${data.length} values`);
  const shapeText = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(', ')})`;
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': ${shapeText}, }`;
  // Magic (6) + version (2) + header length (2) + header must be a multiple of 64, ending in '\n'.
  const preamble = 10;
  const padding = 64 - ((preamble + header.length + 1) % 64);
  header = header + ' '.repeat(padding % 64) + '\n';

  const out = new Uint8Array(preamble + header.length + data.byteLength);
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
  out[8] = header.length & 0xff;
  out[9] = header.length >> 8;
  for (let i = 0; i < header.length; i++) out[preamble + i] = header.charCodeAt(i);
  const body = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('big-endian hosts are not supported');
  out.set(body, preamble + header.length);
  return out;
}

/** Encodes RGBA8 pixels (top-down) as PNG using the browser's canvas encoder. */
export async function encodePng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable for PNG encoding');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

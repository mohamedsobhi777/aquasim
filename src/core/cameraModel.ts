/** Pinhole intrinsics in OpenCV convention (pixels, origin at top-left). */
export interface Intrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/** three.js PerspectiveCamera uses a vertical field of view and square pixels. */
export function intrinsicsFromVerticalFov(vfovDeg: number, width: number, height: number): Intrinsics {
  if (vfovDeg <= 0 || vfovDeg >= 180) throw new Error(`invalid vertical fov: ${vfovDeg}`);
  if (width <= 0 || height <= 0) throw new Error(`invalid image size: ${width}x${height}`);
  const fy = height / 2 / Math.tan((vfovDeg * Math.PI) / 360);
  return { fx: fy, fy, cx: width / 2, cy: height / 2, width, height };
}

/** Converts a camera-to-world matrix from the three.js/OpenGL camera frame (x right, y up, looking -z) to OpenCV (x right, y down, looking +z). */
export function glToCvCameraToWorld(colMajor: readonly number[]): number[] {
  if (colMajor.length !== 16) throw new Error('expected a 4x4 column-major matrix');
  const out = [...colMajor];
  // Negate the camera's y and z basis columns.
  for (let row = 0; row < 3; row++) {
    out[4 + row] = -colMajor[4 + row];
    out[8 + row] = -colMajor[8 + row];
  }
  return out;
}

/**
 * Pure (renderer-free) underwater image-formation parameters, following the
 * revised model of Akkaynak & Treibitz (CVPR 2018):
 *
 *   I = J * exp(-betaD * z) + Binf * (1 - exp(-betaB * z))
 *
 * where z is the optical path length from camera to surface. Direct
 * attenuation (betaD) and backscatter (betaB) use separate coefficients.
 * Values are visually tuned approximations, not calibrated measurements.
 */
export type Rgb = readonly [number, number, number];

export interface WaterType {
  /** Direct-signal attenuation per metre, per RGB channel. */
  betaD: Rgb;
  /** Backscatter coefficient per metre, per RGB channel. */
  betaB: Rgb;
  /** Veiling-light colour at the surface (scaled by downwelling light at depth). */
  veilingColor: Rgb;
  /** Diffuse downwelling attenuation Kd per metre, controls ambient light vs depth. */
  kd: Rgb;
}

/** Clear open ocean (Jerlov type I-like), the only water type for now. */
export const CLEAR_OCEAN: WaterType = {
  betaD: [0.37, 0.07, 0.045],
  betaB: [0.3, 0.06, 0.04],
  veilingColor: [0.02, 0.16, 0.32],
  kd: [0.35, 0.05, 0.03],
};

export interface WaterSettings {
  /** 0..1, adds wavelength-independent scattering from suspended sediment. */
  turbidity: number;
  /** Camera depth below the surface in metres. */
  depth: number;
}

export interface WaterCoefficients {
  betaD: Rgb;
  betaB: Rgb;
  /** Veiling light at infinity for the current depth. */
  bInf: Rgb;
  /** Downwelling ambient light transmittance at the current depth. */
  ambient: Rgb;
}

/** Extra scattering per metre at turbidity = 1 (sediment is roughly grey). */
const TURBIDITY_BETA = 0.45;
/** Sediment tints the veiling light toward a brownish grey. */
const SEDIMENT_COLOR: Rgb = [0.16, 0.15, 0.11];

export function transmittance(beta: Rgb, distance: number): Rgb {
  const d = Math.max(0, distance);
  return [Math.exp(-beta[0] * d), Math.exp(-beta[1] * d), Math.exp(-beta[2] * d)];
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const mapRgb = (a: Rgb, fn: (v: number, i: number) => number): Rgb => [fn(a[0], 0), fn(a[1], 1), fn(a[2], 2)];

export function computeWaterCoefficients(settings: WaterSettings, preset: WaterType = CLEAR_OCEAN): WaterCoefficients {
  const turbidity = clamp01(settings.turbidity);
  const extra = TURBIDITY_BETA * turbidity;
  const ambient = transmittance(preset.kd, settings.depth);
  const veiling = mapRgb(preset.veilingColor, (v, i) => v + (SEDIMENT_COLOR[i] - v) * turbidity * 0.6);

  return {
    betaD: mapRgb(preset.betaD, (v) => v + extra),
    betaB: mapRgb(preset.betaB, (v) => v + extra * 1.2),
    bInf: mapRgb(veiling, (v, i) => v * ambient[i]),
    ambient,
  };
}

/** Applies the image-formation model to a linear RGB surface radiance J at range z. */
export function formImage(j: Rgb, z: number, c: Pick<WaterCoefficients, 'betaD' | 'betaB' | 'bInf'>): Rgb {
  const direct = transmittance(c.betaD, z);
  const back = transmittance(c.betaB, z);
  return mapRgb(j, (v, i) => v * direct[i] + c.bInf[i] * (1 - back[i]));
}

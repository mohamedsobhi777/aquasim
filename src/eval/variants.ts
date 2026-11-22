import type { SimSettings } from '../core/settings';

/**
 * One rendering configuration in an evaluation. Each variant removes one
 * effect from the reference (everything on), so the difference to the
 * reference is that effect's cost and its contribution to the image.
 */
export interface EvalVariant {
  id: string;
  label: string;
  apply(settings: SimSettings): void;
}

export const REFERENCE_VARIANT: EvalVariant = { id: 'reference', label: 'All effects on', apply: () => {} };

export const EFFECT_VARIANTS: readonly EvalVariant[] = [
  { id: 'no-water', label: 'Without underwater image formation', apply: (s) => (s.water.enabled = false) },
  { id: 'no-inscatter', label: 'Without lamp in-scatter (visible beams)', apply: (s) => (s.lamps.scatter = 0) },
  { id: 'no-beam-shadows', label: 'Without shadows inside the beams', apply: (s) => (s.lamps.beamShadows = false) },
  { id: 'no-shadows', label: 'Without lamp shadows', apply: (s) => (s.lamps.shadows = false) },
  { id: 'no-particles', label: 'Without suspended particles', apply: (s) => (s.particles.count = 0) },
  { id: 'no-sediment', label: 'Without kicked-up sediment', apply: (s) => (s.sediment.enabled = false) },
  { id: 'no-lod', label: 'Without level of detail (full geometry)', apply: (s) => (s.render.lod = false) },
  {
    id: 'baseline',
    label: 'Plain rendering (all effects off, LOD on)',
    apply: (s) => {
      s.water.enabled = false;
      s.lamps.scatter = 0;
      s.lamps.shadows = false;
      s.particles.count = 0;
      s.sediment.enabled = false;
    },
  },
];

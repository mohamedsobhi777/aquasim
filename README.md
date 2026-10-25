# AquaSim

Browser-based underwater simulator for generating labelled camera datasets for
underwater robot perception (COMP5411 Group 18). Vite + TypeScript + three.js.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run typecheck
```

## Controls

WASD move · Q/E down/up · arrow keys or mouse drag to look · Shift boost.
**V** (or View → camera) switches between the robot's camera and a world
camera that orbits and follows the robot (drag to orbit, wheel to zoom).
Captures always use the robot's camera, with the robot model hidden.
The panel on the right controls water, lamps, particles, view mode, replay of
inspection paths and dataset capture. `window.aquasim` exposes the app in the
console.

## Layout

```
src/
  app.ts                  runtime: renderer, loop, playback, capture orchestration
  core/                   shared simulator core (both scenarios)
    waterModel.ts         pure image-formation parameters (Akkaynak & Treibitz 2018)
    water.ts              shader patch: attenuation, veiling light, lamp backscatter
    rov.ts                camera robot (camera + 2 shadowed lamps) and piloting
    rovModel.ts           vehicle geometry shown in the world view
    particles.ts          suspended particles, drift and robot wake are functions of sim time
    robotTrack.ts         robot path sampled on a fixed time grid (drives wake and sediment)
    sediment.ts           silt kicked up by the thrusters when flying low (visual only)
    lod.ts                instanced level of detail with stable instance ids
    terrainLod.ts         chunked seabed with error-driven level of detail
    labelPasses.ts        depth / semantic+instance passes, shared vertex deformation
    capture.ts            off-screen RGB + depth + mask capture at fixed resolution
    dataset.ts            dataset layout, zip / folder sinks
    trajectory.ts         poses, interpolation, look-at paths
    sceneModule.ts        the interface every scenario implements
  scenes/
    registry.ts           scenario list
    infrastructure/       inspection scenario: seabed, pipeline + riser, jacket,
                          subsea template (trees, manifold), PLET + jumper,
                          umbilical + J-tube, mattresses, rocks and debris
  eval/                   effect-by-effect evaluation (variants, metrics, runner)
  ui/                     lil-gui panel, HUD and evaluation table
tests/                    vitest unit tests
```

## Effects

- **Shadows inside the beams**: the lamp in-scatter march samples each lamp's
  shadow map, so structures cast dark shafts through the lit water.
- **Robot wake**: particles near the recent robot path are pushed along and
  aside by its motion.
- **Kicked-up sediment**: below about 1.8 m altitude the thrusters lift silt
  puffs that drift with the current and settle over ~25 s. They hide
  structure in RGB only; depth and masks still see through them. The
  `valve-approach` path flies low near the PLET to show this.
- **Level of detail**: rocks switch between three meshes by projected size
  and the seabed is chunked with error-bounded levels. Instance ids are the
  same at every level, so masks do not change when a level switches.

Wake and sediment are pure functions of the robot track and sim time, so
trajectory captures stay deterministic.

## Evaluation

Panel → Evaluation → _evaluate effects on path_ replays the selected path at
evenly spaced poses with time frozen, once per configuration: all effects on,
each effect switched off in turn, no LOD, and plain rendering. Per
configuration it records:

- GPU-synced RGB frame time (median and p95) and the time saved against all
  effects;
- triangles and draw calls (shadow passes included);
- image change against all effects (changed pixels, PSNR) and RMS contrast;
- label checks: mask pixels identical to the reference, and the worst frame's
  agreement between depth and mask coverage.

The results appear as a table and download as `evaluation.json` and
`evaluation.csv` in one zip. The resolution is the capture resolution.
Variants are interleaved per pose so GPU clock changes affect all of them
alike. Timings vary by about ±1 ms between runs, so compare large
differences only, or raise _timed renders / pose_.

## Code style

`npm run format` (Prettier, `.prettierrc.json`) before committing; `npm run format:check` verifies it.
camelCase for functions and variables, PascalCase for types and classes, UPPER_SNAKE_CASE for module constants.
No debug `console.log`; report problems through `app.onStatus` or thrown errors. Third-party code lives unchanged in
`src/vendor/`. Run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once so blame skips the formatting commit.

## Adding a scenario

Implement `SceneModule` (`src/core/sceneModule.ts`) and add it to
`src/scenes/registry.ts`. The core supplies the camera, lamps, water,
particles, playback and capture; a scenario supplies:

- `root` geometry, with every labelled mesh tagged via `tagSemantic(mesh, classId)`
  and visual-only objects marked with `excludeFromLabels(object)`;
- `classes` (ids 1-255; 0 is water);
- default `water` settings, `surfaceHeight`, `groundHeight(x, z)` and a `spawn` pose;
- seeded `trajectories` for repeatable capture;
- optional `update(time, dt)` driven by simulation time only.

Materials must go through `patchUnderwater(material)` to get the water model.
If a material deforms vertices (e.g. coral sway), pass the same
`VertexDeformation` to `patchUnderwater(material, deformation)` and to
`setVertexDeformation(mesh, deformation)`; depth and masks then follow the
deformed geometry. See the hanging rope in
`scenes/infrastructure/debris.ts`.

## Dataset format

A capture writes one folder (Chromium folder picker) or a `.zip`:

| Path                  | Content                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `rgb/NNNNNN.png`      | sRGB, tone mapped, as displayed                                      |
| `depth/NNNNNN.npy`    | float32 `[H, W]`, planar z-depth in metres; 0 = open water           |
| `semantic/NNNNNN.png` | R = class id, G·256 + B = instance id; 0 = water                     |
| `meta/NNNNNN.json`    | sim time, OpenCV intrinsics, camera-to-world (GL and OpenCV frames)  |
| `preview/*.png`       | colourised depth and masks for inspection                            |
| `dataset.json`        | classes, instance table, seed, trajectory, all settings, conventions |

Labels cover opaque scene surfaces only; water and suspended particles are
excluded. Depth is a rendered geometric quantity, not a simulated sensor.
The RGB shader is a plausible approximation, not a calibrated optical model.

# AquaSim

Browser-based underwater simulator for underwater robot perception
(COMP5411 Group 18). Vite + TypeScript + three.js.

This branch is the progress-update version. An earlier, larger prototype
(robot with lamps, inspection installation, dataset capture, evaluation) is
kept on the `full-prototype` branch for reference.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run typecheck
```

## Controls

WASD move · Q/E down/up · arrow keys or mouse drag to look. The HUD shows the
camera depth below the water surface (0 m at the surface). The panel on the
right selects the scenario and seed and controls water and suspended
particles. `window.aquasim` exposes the app in the console.

## Layout

```
src/
  app.ts                  renderer, frame loop, lighting, water update
  core/                   shared simulator core (both scenarios)
    waterModel.ts         clear open ocean image-formation parameters (Akkaynak & Treibitz 2018)
    water.ts              shader patch: attenuation and veiling light
    flyCamera.ts          free camera and keyboard/mouse controls
    particles.ts          suspended particles drifting with the current
    lod.ts                instanced level of detail
    terrainLod.ts         chunked seabed with error-driven level of detail
    pose.ts               camera poses
    sceneModule.ts        the interface every scenario implements
  scenes/
    registry.ts           scenario list
    infrastructure/       seabed and rock outcrops
    coral/                reef seabed with branching and brain corals
  vendor/fastnoise-lite/  third-party noise (MIT)
  ui/                     lil-gui panel and HUD
tests/                    vitest unit tests
```

## Code style

`npm run format` (Prettier, `.prettierrc.json`) before committing; `npm run format:check` verifies it.
camelCase for functions and variables, PascalCase for types and classes, UPPER_SNAKE_CASE for module constants.
Third-party code lives unchanged in `src/vendor/`. Run `git config blame.ignoreRevsFile .git-blame-ignore-revs`
once so blame skips the formatting commit.

## Adding a scenario

Implement `SceneModule` (`src/core/sceneModule.ts`) and add it to
`src/scenes/registry.ts`. The core supplies the camera, water and particles;
a scenario supplies `root` geometry, a default `turbidity`, `surfaceHeight`,
`groundHeight(x, z)`, a `spawn` pose and an optional `update(time, dt)`
driven by simulation time. Materials must go through
`patchUnderwater(material)` to get the water model.

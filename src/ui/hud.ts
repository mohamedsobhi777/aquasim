import * as THREE from 'three';
import type { AquaSimApp } from '../app';

const HELP_ROBOT = 'WASD move · Q/E down/up · arrows / drag look · Shift boost · V world view';
const HELP_WORLD = 'WASD move robot · Q/E down/up · arrows turn · drag orbit · wheel zoom · V robot view';

function row(key: string, value: string): string {
  return `<div class="row"><span class="key">${key}</span><span>${value}</span></div>`;
}

export function startHud(app: AquaSimApp, element: HTMLElement): void {
  let status = '';
  app.onStatus = (message) => {
    status = message;
  };
  const euler = new THREE.Euler();

  const update = (): void => {
    const p = app.rov.body.position;
    euler.setFromQuaternion(app.rov.body.quaternion, 'YXZ');
    const depth = app.scenario.surfaceHeight - p.y;
    const heading = (THREE.MathUtils.radToDeg(-euler.y) + 360) % 360;
    const mode = app.playback ? `replay ${app.playback.trajectory.name}` : app.controller.enabled ? 'manual' : 'locked';
    // Built from numbers and fixed strings only, so innerHTML is safe here.
    element.innerHTML = [
      '<div class="title">AquaSim · inspection ROV</div>',
      row('frame', `${app.stats.percentile(50).toFixed(1)} ms p50 · ${app.stats.percentile(95).toFixed(1)} ms p95`),
      row('depth', `${depth.toFixed(1)} m · alt ${(p.y - app.scenario.groundHeight(p.x, p.z)).toFixed(1)} m`),
      row('pos', `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`),
      row('heading', `${heading.toFixed(0)}° · pitch ${THREE.MathUtils.radToDeg(euler.x).toFixed(0)}°`),
      row('sim', `${app.clock.now.toFixed(1)} s${app.clock.isPaused ? ' (paused)' : ''} · ${mode}`),
      row(
        'geometry',
        `${(app.lodStats.triangles / 1000).toFixed(0)}k tris (LOD ${app.settings.render.lod ? 'on' : 'off'}) · ${app.sediment.puffCount} silt puffs`,
      ),
      row(
        'view',
        `${app.settings.render.camera} camera · ${app.settings.render.view} · ${app.instanceCount} labelled instances`,
      ),
      status ? `<div class="status">${status.replace(/[<>&]/g, '')}</div>` : '',
      `<div class="help">${app.settings.render.camera === 'world' ? HELP_WORLD : HELP_ROBOT}</div>`,
    ].join('');
  };
  setInterval(update, 200);
}

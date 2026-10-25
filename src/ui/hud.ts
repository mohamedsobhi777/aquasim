import type { AquaSimApp } from '../app';
import { findScene } from '../scenes/registry';

const HELP = 'WASD move · Q/E down/up · arrow keys / drag to look';

export function startHud(app: AquaSimApp, element: HTMLElement): void {
  const title = document.createElement('div');
  title.className = 'title';
  const depth = document.createElement('div');
  const help = document.createElement('div');
  help.className = 'help';
  help.textContent = HELP;
  element.append(title, depth, help);

  const update = (): void => {
    title.textContent = `AquaSim · ${findScene(app.settings.sceneId).label}`;
    depth.textContent = `Depth: ${app.depth.toFixed(1)} m below surface`;
  };
  update();
  setInterval(update, 200);
}

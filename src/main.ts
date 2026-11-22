import { AquaSimApp } from './app';
import { startHud } from './ui/hud';
import { createPanel } from './ui/panel';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
const hud = document.querySelector<HTMLElement>('#hud');
if (!canvas || !hud) throw new Error('index.html is missing #viewport or #hud');

const app = new AquaSimApp(canvas);
createPanel(app);
startHud(app, hud);
requestAnimationFrame(app.frame);

// Handy for debugging and scripted captures from the console.
(window as unknown as { aquasim: AquaSimApp }).aquasim = app;

import "./style.css";

import { CoralMonitorApp } from "./CoralMonitorApp";

function window_onResize() {
  // camera.aspect = window.innerWidth / window.innerHeight;
  // camera.updateProjectionMatrix();
  // renderer.setSize(window.innerWidth, window.innerHeight);
}

async function main() {
  const app = new CoralMonitorApp("root");
  app.init();
}

main();

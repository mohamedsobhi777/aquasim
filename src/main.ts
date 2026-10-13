import "./style.css";
import "./coral-monitor/style.css";

import { CMApp } from "./coral-monitor/CMApp";

async function main() {
  const cmApp = new CMApp("#app");
  (window as any).cmApp = cmApp;

  await cmApp.init();
}

main();

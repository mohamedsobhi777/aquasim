import "./style.css";
import "./coral-monitor/style.css";

import { CMApp } from "./coral-monitor/CMApp";

async function main() {
  const cmApp = new CMApp("#app");
  cmApp.init();

  (window as any).cmApp = cmApp;
}

main();

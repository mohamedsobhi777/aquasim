import "./style.css";
import "./coral-monitor/style.css";

import { CMApp } from "./coral-monitor/CMApp";

async function main() {
  const app = new CMApp("#root");
  app.init();
}

main();

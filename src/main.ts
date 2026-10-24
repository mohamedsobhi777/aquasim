import "./style.css";
import "./infra-inspect/style.css";
import "./coral-monitor/style.css";

import { CMApp } from "./coral-monitor/CMApp";
import { InfraApp } from "./infra-inspect/InfraApp";

class RootApp {
  private divIntroScreen: HTMLDivElement;

  private headerItem_infra: HTMLDivElement;
  private headerItem_coral: HTMLDivElement;

  constructor() {
    this.divIntroScreen = document.querySelector(
      "#intro-screen",
    ) as HTMLDivElement;

    this.headerItem_infra = this.divIntroScreen.querySelector(
      ".scenario-infra",
    ) as HTMLDivElement;
    this.headerItem_coral = this.divIntroScreen.querySelector(
      ".scenario-coral",
    ) as HTMLDivElement;

    this.headerItem_infra.addEventListener(
      "click",
      this.headerItem_infra_onClick.bind(this),
    );
    this.headerItem_coral.addEventListener(
      "click",
      this.headerItem_coral_onClick.bind(this),
    );

    document.title = "AquaSim";
  }

  // #region [events]
  private async headerItem_infra_onClick() {
    this.scenario_beforeOpen();

    document.title = "Underwater Infrastructure Inspection";

    const infraApp = new InfraApp({
      containerElement: document.querySelector("#d3-app") as HTMLDivElement,
      onClose: this.scenario_afterClose.bind(this),
    });

    await infraApp.init();
  }

  private async headerItem_coral_onClick() {
    this.scenario_beforeOpen();

    document.title = "Coral Reef Monitoring";

    const cmApp = new CMApp({
      containerElement: document.querySelector("#d3-app") as HTMLDivElement,
      onClose: this.scenario_afterClose.bind(this),
    });

    await cmApp.init();
  }

  private scenario_beforeOpen() {
    this.divIntroScreen.style.display = "none";
  }

  private scenario_afterClose() {
    this.divIntroScreen.style.display = "flex";
    document.title = "AquaSim";
  }
  // #endregion [events]
}

async function main() {
  // const rootApp = new RootApp();

  (document.querySelector("#intro-screen") as HTMLDivElement).style.display =
    "none";

  const cmApp = new CMApp({
    containerElement: document.querySelector("#d3-app") as HTMLDivElement,
  });
  (window as any).cmApp = cmApp;

  await cmApp.init();
}

main();

import "./style.css";
import "./coral-monitor/style.css";

import { CMApp } from "./coral-monitor/CMApp";

class RootApp {
  private divIntroScreen: HTMLDivElement;

  private headerItem_uii: HTMLDivElement;
  private headerItem_crm: HTMLDivElement;

  constructor() {
    this.divIntroScreen = document.querySelector(
      "#intro-screen",
    ) as HTMLDivElement;

    this.headerItem_uii = this.divIntroScreen.querySelector(
      ".scenario-uii",
    ) as HTMLDivElement;
    this.headerItem_crm = this.divIntroScreen.querySelector(
      ".scenario-crm",
    ) as HTMLDivElement;

    this.headerItem_uii.addEventListener(
      "click",
      this.headerItem_uii_onClick.bind(this),
    );
    this.headerItem_crm.addEventListener(
      "click",
      this.headerItem_crm_onClick.bind(this),
    );

    document.title = "AquaSim";
  }

  // #region [events]
  private headerItem_uii_onClick() {}

  private async headerItem_crm_onClick() {
    this.scenario_beforeOpen();

    document.title = "Coral Reef Monitoring";

    const cmApp = new CMApp({
      containerElement: document.querySelector("#d3-app") as HTMLDivElement,
      onClose: this.scenario_afterClose.bind(this),
    });
    (window as any).cmApp = cmApp;

    await cmApp.init();
  }

  private scenario_beforeOpen() {
    this.divIntroScreen.style.display = "none";
  }

  private scenario_afterClose() {
    this.divIntroScreen.style.display = "flex";
    document.title = "Coral Reef Monitoring";
  }
  // #endregion [events]
}

async function main() {
  const rootApp = new RootApp();

  // document.querySelector("#intro-screen")!.style.display = "none";

  // const cmApp = new CMApp({
  //   containerElement: document.querySelector("#d3-app") as HTMLDivElement,
  //   onClose: () => {}
  // });
  // (window as any).cmApp = cmApp;

  // await cmApp.init();
}

main();

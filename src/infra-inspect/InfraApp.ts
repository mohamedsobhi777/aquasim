import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/Addons.js";
import {
    htmlElement_createFromTemplate,
    htmlElement_updateStyle,
    waitAsync,
} from "./lib/utils";

import UIIApp_htmlTemplate from "./InfraApp.html?raw";
import type { ScenarioOnCloseCallback } from "../types";

export class InfraApp {
  private readonly TAG = "InfraApp";

  private containerElement: HTMLDivElement;
  private backBtn!: HTMLDivElement;
  private scenario_onClose: ScenarioOnCloseCallback | undefined = undefined;

  private rootElement!: HTMLDivElement;
  private bootOverlayElement!: HTMLDivElement;

  private initRun: boolean = false;

  private scene!: THREE.Scene;
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;

  private listenerStore: { [key: string]: Function } = {};

  private timerId_loadingEffect?: number;
  private loadingDot_cnt: number = 0;

  constructor(params: {
    containerElement: HTMLDivElement | string;
    onClose?: ScenarioOnCloseCallback;
  }) {
    const { containerElement, onClose } = params;

    this.containerElement =
      typeof containerElement === "string"
        ? (document.querySelector(containerElement) as HTMLDivElement)
        : containerElement;

    this.scenario_onClose = onClose;
  }

  async init() {
    const FN_TAG = `init`;
    const FN_DEBUG_TAG = `[${this.TAG}::${FN_TAG}]`;

    if (this.initRun) {
      return;
    }
    this.initRun = true;

    console.log(`${FN_DEBUG_TAG}. Trigger`);

    const { containerElement } = this;

    const rootElement =
      htmlElement_createFromTemplate<HTMLDivElement>(UIIApp_htmlTemplate);
    this.rootElement = rootElement;

    containerElement.appendChild(rootElement);

    const backBtn = rootElement.querySelector(".back-btn") as HTMLDivElement;
    this.backBtn = backBtn;

    if (this.scenario_onClose) {
      backBtn.addEventListener("click", this.backBtn_onClick.bind(this));
    }

    htmlElement_updateStyle(backBtn, {
      display: "none",
    });

    const bootOverlayElement = rootElement.querySelector(
      ".boot-overlay",
    ) as HTMLDivElement;
    this.bootOverlayElement = bootOverlayElement;

    this.showBooting();

    const scene = new THREE.Scene();
    this.scene = scene;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
    });
    this.renderer = renderer;

    renderer.setClearColor(0xa0a0a0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    rootElement.appendChild(this.renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      2000,
    );
    camera.position.set(0, 5, 5);
    camera.lookAt(0, 0, 0);

    this.camera = camera;

    const controls = new OrbitControls(camera, this.renderer.domElement);
    this.controls = controls;

    this.listenerStore["window_onResize"] = this.window_onResize.bind(this);
    window.addEventListener(
      "resize",
      this.listenerStore["window_onResize"] as EventListener,
    );

    this.resize(window.innerWidth, window.innerHeight);
    this.init_scene();

    this.requestRender();

    // If not wait here, "transitionend" event will not be triggered inside hideBooting()
    await waitAsync(10);
    this.hideBooting();

    if (this.scenario_onClose) {
      htmlElement_updateStyle(backBtn, {
        display: "flex",
      });
    }
  }

  dispose() {
    const FN_TAG = `dispose`;
    const FN_DEBUG_TAG = `[${this.TAG}::${FN_TAG}]`;

    console.log(`${FN_DEBUG_TAG}. Trigger`);

    window.removeEventListener(
      "resize",
      this.listenerStore["window_onResize"] as EventListener,
    );

    this.scene.dispose();
    this.renderer.dispose();

    this.containerElement.removeChild(this.rootElement);
  }

  render(dt: number) {
    this.requestRender();

    const { renderer, controls } = this;

    controls.update();
    renderer.render(this.scene, this.camera);
  }

  resize(newWidth: number, newHeight: number) {
    const { camera, renderer, rootElement } = this;

    htmlElement_updateStyle(rootElement, {
      width: `${newWidth}px`,
      height: `${newHeight}px`,
    });

    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(newWidth, newHeight);
  }

  requestRender() {
    requestAnimationFrame(this.render.bind(this));
  }

  init_scene() {}

  showBooting() {
    // @region [sub]

    const updateLoadingText = () => {
      const elLoadingText =
        this.bootOverlayElement.querySelector(".loading-text");
      elLoadingText!.textContent = "Loading" + ".".repeat(this.loadingDot_cnt);
    };

    // @endregion [sub]

    htmlElement_updateStyle(this.bootOverlayElement, {
      display: "flex",
    });

    updateLoadingText();

    if (this.timerId_loadingEffect !== undefined) {
      clearInterval(this.timerId_loadingEffect);
      this.timerId_loadingEffect = undefined;
    }

    this.timerId_loadingEffect = window.setInterval(() => {
      updateLoadingText();

      ++this.loadingDot_cnt;
      if (this.loadingDot_cnt > 4) {
        this.loadingDot_cnt = 1;
      }
    }, 500);
  }

  hideBooting() {
    const { bootOverlayElement } = this;

    if (this.timerId_loadingEffect !== undefined) {
      clearInterval(this.timerId_loadingEffect);
      this.timerId_loadingEffect = undefined;
    }

    const elLoadingText =
      this.bootOverlayElement.querySelector(".loading-text");
    elLoadingText!.textContent = "Loading successful";

    htmlElement_updateStyle(bootOverlayElement, {
      opacity: "0",
      transition: "opacity 1s ease",
    });

    bootOverlayElement.addEventListener(
      "transitionend",
      () => {
        htmlElement_updateStyle(bootOverlayElement, {
          opacity: "1",
          display: "none",
          transition: "",
        });
      },
      { once: true },
    );
  }

  // @region [events]
  window_onResize() {
    const { renderer } = this;

    const curSize = renderer.getSize(new THREE.Vector2());
    const curWidth = curSize.x;
    const curHeight = curSize.y;

    const container_bound = this.containerElement.getBoundingClientRect();
    const newWidth = container_bound.width;
    const newHeight = container_bound.height;

    if (curWidth == newWidth && curHeight == newHeight) {
      return;
    }

    this.resize(newWidth, newHeight);
  }

  backBtn_onClick() {
    const FN_TAG = `backBtn_onClick`;
    const FN_DEBUG_TAG = `[${this.TAG}::${FN_TAG}]`;

    console.log(`${FN_DEBUG_TAG}. Trigger`);

    const { scenario_onClose } = this;
    if (!scenario_onClose) {
      return;
    }

    this.dispose();

    scenario_onClose();
  }
  // @endregion [events]
}

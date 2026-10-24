import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/Addons.js";
import {
  htmlElement_createFromTemplate,
  htmlElement_updateStyle,
} from "./lib/utils";

import CMApp_htmlTemplate from "./CMApp.html?raw";
import { brainCoral_generate, branchingCoral_generate } from "./reef";
import { setupGenericLightingEnvironment } from "./lib/graphics";

export class CMApp {
  private readonly TAG = "CMApp";

  private containerElement: HTMLDivElement;

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

  constructor(containerElement: HTMLDivElement | string) {
    this.containerElement =
      typeof containerElement === "string"
        ? (document.querySelector(containerElement) as HTMLDivElement)
        : containerElement;
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
      htmlElement_createFromTemplate<HTMLDivElement>(CMApp_htmlTemplate);
    this.rootElement = rootElement;

    containerElement.appendChild(rootElement);

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

    const controls = new OrbitControls(camera, this.rootElement);
    this.controls = controls;

    this.listenerStore["window_onResize"] = this.window_onResize.bind(this);
    window.addEventListener(
      "resize",
      this.listenerStore["window_onResize"] as EventListener,
    );

    this.resize(window.innerWidth, window.innerHeight);
    this.init_scene();

    this.requestRender();

    this.dev_resetCamPosition();

    // await waitAsync(2000);
    this.hideBooting();
  }

  dispose() {
    const FN_TAG = `dispose`;
    const FN_DEBUG_TAG = `[${this.TAG}::${FN_TAG}]`;

    console.log(`${FN_DEBUG_TAG}. Trigger`);

    window.removeEventListener(
      "resize",
      this.listenerStore["window_onResize"] as EventListener,
    );
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

  init_scene() {
    const { scene } = this;

    const worldSeed = 5838;

    scene.add(new THREE.AxesHelper(100));

    setupGenericLightingEnvironment(scene);

    const branchingCoral = branchingCoral_generate({
      root_pt: new THREE.Vector3(0, 0, 0),
      root_forwardVec: new THREE.Vector3(1, 0, 0),
      root_distToCeil: 1,
      root_radius: 0.02,
      growthLevelCnt: 3,
      material: new THREE.MeshStandardMaterial({ color: "#526362" }),
      seedHash: `${worldSeed}/coral/branching/5`,
    });
    scene.add(branchingCoral);

    const brainCoral = brainCoral_generate({
      root_pt: new THREE.Vector3(0.8, 0, 0.8),
      root_forwardVec: new THREE.Vector3(1, 0, 0),
      material: new THREE.MeshStandardMaterial({ color: "#82857c" }),
      x_size: 0.55,
      z_size: 0.6,
      height: 0.3,
      seedHash: `${worldSeed}/coral/brain/1`
    });
    scene.add(brainCoral);
  }

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
  // @endregion [events]

  // @region [dev_util]
  dev_resetCamPosition() {
    const { camera } = this;
    camera.position.set(2, 2, 2);
    camera.lookAt(0, 0, 0);
  }
  // @endregion [dev_util]
}

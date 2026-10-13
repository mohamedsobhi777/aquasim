import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/Addons.js";
import { CM_APP_CSS_CLASS } from "./const";
import { htmlElement_addClass, htmlElement_updateStyle } from "./utils";

export class CMApp {
  private readonly TAG = "CMApp";

  private rootElement: HTMLDivElement;

  private initRun: boolean = false;

  private scene!: THREE.Scene;
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;

  constructor(rootElement: HTMLDivElement | string) {
    this.rootElement =
      typeof rootElement === "string"
        ? (document.querySelector(rootElement) as HTMLDivElement)
        : rootElement;
  }

  init() {
    const FN_TAG = `init`;
    const FN_DEBUG_TAG = `[${this.TAG}::${FN_TAG}]`;

    if (this.initRun) {
      return;
    }
    this.initRun = true;

    console.log(`${FN_DEBUG_TAG}. Trigger`);

    const { rootElement } = this;

    const scene = new THREE.Scene();
    this.scene = scene;

    const renderer = new THREE.WebGLRenderer();
    this.renderer = renderer;

    renderer.setClearColor(0xa0a0a0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    htmlElement_addClass(rootElement, CM_APP_CSS_CLASS, "root");

    rootElement.appendChild(this.renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      1,
      2000,
    );
    camera.position.set(0, 5, 5);
    camera.lookAt(0, 0, 0);

    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    this.controls = controls;

    window.addEventListener("resize", this.window_onResize.bind(this));

    this.resize(window.innerWidth, window.innerHeight);
    this.init_scene();

    this.requestRender();

    this.dev_resetCamPosition();
  }

  dispose() {}

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

    scene.add(new THREE.AxesHelper(100));

    const geometry = new THREE.CylinderGeometry(5, 5, 20, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const cylinder = new THREE.Mesh(geometry, material);

    scene.add(cylinder);
  }

  // @region [events]
  window_onResize() {
    const { renderer } = this;

    const curSize = renderer.getSize(new THREE.Vector2());
    const curWidth = curSize.x;
    const curHeight = curSize.y;

    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight;

    if (curWidth == newWidth && curHeight == newHeight) {
      return;
    }

    this.resize(newWidth, newHeight);
  }
  // @endregion [events]

  // @region [dev_util]
  dev_resetCamPosition() {
    const { camera } = this;
    camera.position.set(10, 10, 10);
    camera.lookAt(0, 0, 0);
  }
  // @endregion [dev_util]
}

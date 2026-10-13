import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/Addons.js";
import { CM_APP_CSS_CLASS } from "./const";

export class CMApp {
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
    if (this.initRun) {
      return;
    }
    this.initRun = true;

    const { rootElement } = this;

    const scene = new THREE.Scene();
    this.scene = scene;

    const renderer = new THREE.WebGLRenderer();
    this.renderer = renderer;

    renderer.setClearColor(0xa0a0a0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    rootElement.classList.add(CM_APP_CSS_CLASS, "root")
    rootElement.appendChild(this.renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      1,
      2000,
    );
    camera.position.z = 5;

    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    this.controls = controls;

    window.addEventListener("resize", this.window_onResize.bind(this));

    this.resize(window.innerWidth, window.innerHeight);
    this.init_scene();

    this.requestRender();
  }

  dispose() {
    // TODO
  }

  render(dt: number) {
    this.requestRender();

    const { renderer, controls } = this;

    controls.update();
    renderer.render(this.scene, this.camera);
  }

  resize(newWidth: number, newHeight: number) {
    const { camera, renderer } = this;

    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(newWidth, newHeight);
  }

  requestRender() {
    requestAnimationFrame(this.render.bind(this));
  }

  init_scene() {
    // TODO
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
}

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/Addons.js";

import * as dat from "dat.gui";

export class CoralMonitorApp {
  private rootElement: HTMLDivElement;

  private scene!: THREE.Scene;
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;

  constructor(rootElement: HTMLDivElement | string) {
    this.rootElement =
      typeof rootElement === "string"
        ? (document.getElementById(rootElement) as HTMLDivElement)
        : rootElement;
  }

  init() {
    const scene = new THREE.Scene();
    this.scene = scene;

    const renderer = new THREE.WebGLRenderer();
    this.renderer = renderer;

    renderer.setClearColor(0xa0a0a0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    this.rootElement.appendChild(this.renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      1,
      2000,
    );
    camera.position.z = 10;

    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    this.controls = controls;
  }

  dispose() {
    // TODO
  }
}

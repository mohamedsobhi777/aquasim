import "./style.css";

import { OrbitControls } from "three/examples/jsm/Addons.js";

import * as THREE from "three";
import * as dat from "dat.gui";
import { CoralMonitorScenario } from "./CoralMonitorScenario";

let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;

function window_onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);

  // TODO

  renderer.render(scene, camera);
  controls.update();
}

async function main() {
  scene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer();

  renderer.setClearColor(0xa0a0a0);

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  document.body.appendChild(renderer.domElement);

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    1,
    2000,
  );
  camera.position.z = 10;

  controls = new OrbitControls(camera, renderer.domElement);

  const axesHelper = new THREE.AxesHelper(200);
  scene.add(axesHelper);

  const gui = new dat.GUI();
  gui.open();

  animate();

  window.addEventListener("resize", window_onResize, false);

  const coralScenario = new CoralMonitorScenario(scene, camera, renderer, gui);
  coralScenario.init();
}

main();

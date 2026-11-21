import * as THREE from "three";
import "./style.css";
import {
  DRACOLoader,
  GLTFLoader,
  OrbitControls,
} from "three/examples/jsm/Addons.js";
import { Pane } from "tweakpane";
import { createRenderer, setupResize } from "./core/Renderer.js";
import { SetupAlley } from "./scene/Alley.js";
import { BoxGeometry } from "three";
import { MeshBasicMaterial } from "three";
import { SetupFog } from "./effects/fog.js";

// Setup Canvas & Core
const canvas = document.querySelector("canvas");
const { renderer, camera } = createRenderer(canvas);
const scene = new THREE.Scene();
scene.background = new THREE.Color("black");
setupResize(camera, renderer);

const clock = new THREE.Clock();

// Controls
let controls = null;

// Loaders & Managers
const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
const draco = new DRACOLoader(loadingManager);
draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
const glbLoader = new GLTFLoader();
glbLoader.setDRACOLoader(draco);

// Tweakpane UI Setup (Optional Debugging)
const pane = new Pane();

let activeCamera = camera;
const alley = await SetupAlley(scene, textureLoader, glbLoader);

if (alley.camera) {
  activeCamera = alley.camera;
  if (activeCamera.isPerspectiveCamera && canvas) {
    activeCamera.aspect = canvas.clientWidth / canvas.clientHeight;
    activeCamera.updateProjectionMatrix();
  }

  activeCamera.position.z -= -2;
  activeCamera.far = 100;

  // controls = new OrbitControls(activeCamera, canvas);
}



const Fog = SetupFog(scene, camera, pane);

// Animation Loop
let lastTime = clock.getElapsedTime();

function animate() {
  const time = clock.getElapsedTime();
  const deltaTime = time - lastTime;
  lastTime = time;

  if (controls) {
    controls.update(deltaTime);
  }

  renderer.render(scene, activeCamera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);


function resize(){
  if (activeCamera.isPerspectiveCamera && canvas) {
    activeCamera.aspect = canvas.clientWidth / canvas.clientHeight;
    activeCamera.updateProjectionMatrix();
  }

}

import * as THREE from "three";
import { DirectionalLight } from "three";
import { TextureLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/Addons.js";

export async function SetupAlley(
  scene = new THREE.Scene(),
  tLoader = new TextureLoader(),
  glbLoader = new GLTFLoader(),
) {
  const mat = new THREE.MeshStandardMaterial({
    color: "#999999",
    roughness: 0.5,
    metalness: 0.1,
  });

  const AlleyModel = await glbLoader.loadAsync("/models/modern_alleyway.glb");

  AlleyModel.scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = mat;
    }
  });

  // Don't forget to add the loaded model to the scene
  scene.add(AlleyModel.scene);

  const alleyCamera = AlleyModel.cameras[0] ?? null;

  scene.add(new THREE.AmbientLight(0xffffff, 2.5));
  const dir = new DirectionalLight(0xffffff, 1.5);
  dir.position.set(10, 10, 10);
  scene.add(dir);

  return { camera: alleyCamera, model: AlleyModel.scene };
}

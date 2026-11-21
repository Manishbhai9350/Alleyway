import * as THREE from "three";
import { Pane } from "tweakpane";

const vertexShader = /* glsl */ `
  attribute float aSeed;
  attribute float aColorMix;

  varying vec2 vUv;
  varying float vSeed;
  varying float vColorMix;
  varying float vWorldZ;

  void main() {
    vUv = uv;
    vSeed = aSeed;
    vColorMix = aColorMix;

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldZ = worldPosition.z;

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uNoiseScale;
  uniform float uSpeed;
  uniform float uCloudThreshold;
  uniform float uCloudContrast;
  uniform int uNoiseMode; // 0 = Value FBM (warped), 1 = Billowy / Puff Clouds
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uStartZ;
  uniform float uEndZ;
  uniform float uEdgeSoftness;

  // Progress-based opacity uniforms (0.0 at uStartZ -> 1.0 at uEndZ)
  uniform float uProgressStartOpacity;
  uniform float uProgressEndOpacity;
  uniform float uProgressCurve;
  uniform float uProgressWeight;

  varying vec2 vUv;
  varying float vSeed;
  varying float vColorMix;
  varying float vWorldZ;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbmValue(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += a * valueNoise(p);
      p = rot * p * 2.03;
      a *= 0.5;
    }
    return v;
  }

  float fbmBillowy(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      float n = valueNoise(p);
      float puff = 1.0 - abs(n * 2.0 - 1.0);
      v += a * (puff * puff);
      p = rot * p * 2.01;
      a *= 0.48;
    }
    return v;
  }

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float radialMask = 1.0 - smoothstep(0.3, 1.0, length(centered));

    vec2 seedOffset = vec2(vSeed * 17.31, vSeed * 9.17);
    vec2 drift = vec2(
      uTime * uSpeed * sin(0.6 + fract(vSeed * 3.1) * 0.8),
      uTime * uSpeed * 0.25 + sin(vSeed * 5.1) * 0.15
    ) * 0.0;

    vec2 uv = vUv * uNoiseScale + seedOffset + drift;

    float angle = fbmValue((uv + uTime * .001) * .0001) * 6.28318530718; // 2 * PI
    uv *= mat2(cos(angle), -sin(angle), sin(angle), cos(angle));

    float n1 = (uNoiseMode == 1) ? fbmBillowy(uv) : fbmValue(uv);
    float warpStrength = (uNoiseMode == 1) ? 0.75 : 1.35;
    float n2 = (uNoiseMode == 1)
      ? fbmBillowy(uv + vec2(n1 * warpStrength, -uTime * uSpeed * 0.35))
      : fbmValue(uv + vec2(n1 * warpStrength, -uTime * uSpeed * 0.4));

    float upper = clamp(uCloudThreshold + max(0.08, uCloudContrast), uCloudThreshold + 0.05, 0.99);
    float mist = smoothstep(uCloudThreshold, upper, n2);

    // Normalized progress from startZ (0.0) to endZ (1.0) regardless of startZ > endZ or startZ < endZ
    float denom = uEndZ - uStartZ;
    float rawProgress = (abs(denom) > 0.0001)
      ? clamp((vWorldZ - uStartZ) / denom, 0.0, 1.0)
      : 1.0;
    float curvedProgress = pow(rawProgress, max(0.05, uProgressCurve));
    float progressOpacity = mix(uProgressStartOpacity, uProgressEndOpacity, curvedProgress);
    float progressFactor = mix(1.0, progressOpacity, clamp(uProgressWeight, 0.0, 1.0));

    // Smooth fade within the world Z bounds [minZ, maxZ]
    float minZ = min(uStartZ, uEndZ);
    float maxZ = max(uStartZ, uEndZ);
    float soft = max(0.001, uEdgeSoftness);
    float zFade = smoothstep(minZ, minZ + soft, vWorldZ) * (1.0 - smoothstep(maxZ - soft, maxZ, vWorldZ));

    float alpha = mist * radialMask * progressFactor * uOpacity;
    if (alpha < 0.01) discard;

    float shadeMix = clamp(vColorMix * 0.5 + n2 * 0.65 + (n1 - 0.5) * 0.25, 0.0, 1.0);
    vec3 col = mix(uColorA, uColorB, shadeMix);

    gl_FragColor = vec4(col, alpha);
  }
`;

export function SetupFog(scene = new THREE.Scene(), camera, pane = new Pane()) {
  const zOffset = 10;
  const params = {
    baseColor: "#0f2028",
    scatterColor: "#2a8189",
    fogDensity: 0.049,
    syncBackground: true,

    // World Z bounds for the dense fog area
    startZ: 25 + zOffset,
    endZ: 21 + zOffset,
    edgeSoftness: 20.0,

    // Progress-based opacity from startZ (0) -> endZ (1)
    progressWeight: 1.0,
    progressStartOpacity: 0.15,
    progressEndOpacity: 1.0,
    progressCurve: 1.0,

    // Dense fog area dimensions & placement
    areaWidth: 20.0,
    areaHeight: 20.0,
    centerX: 0.0,
    centerY: 5,

    // Plane count, opacity & noise
    planeCount: 90,
    opacity: 0.75,
    noiseMode: "valueFbm", // "billowy" or "valueFbm"
    noiseScale: 1.5,
    driftSpeed: 0.14,
    cloudThreshold: 0.31,
    cloudContrast: 0.41,
    additive: false,

    // Debug bounds for the world Z area
    showDebug: true,
    debugColor: "#f97316",
  };

  scene.fog = new THREE.FogExp2(params.baseColor, params.fogDensity);
  scene.background = new THREE.Color(params.baseColor);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: params.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: params.opacity },
      uNoiseScale: { value: params.noiseScale },
      uSpeed: { value: params.driftSpeed },
      uCloudThreshold: { value: params.cloudThreshold },
      uCloudContrast: { value: params.cloudContrast },
      uNoiseMode: { value: params.noiseMode === "billowy" ? 1 : 0 },
      uColorA: { value: new THREE.Color(params.baseColor) },
      uColorB: { value: new THREE.Color(params.scatterColor) },
      uStartZ: { value: params.startZ },
      uEndZ: { value: params.endZ },
      uEdgeSoftness: { value: params.edgeSoftness },
      uProgressStartOpacity: { value: params.progressStartOpacity },
      uProgressEndOpacity: { value: params.progressEndOpacity },
      uProgressCurve: { value: params.progressCurve },
      uProgressWeight: { value: params.progressWeight },
    },
  });

  let fogPlanes = null;
  const dummy = new THREE.Object3D();

  function rebuildFogPlanes() {
    if (fogPlanes) {
      scene.remove(fogPlanes);
      fogPlanes.geometry.dispose();
    }

    const count = Math.max(1, params.planeCount);
    const geometry = new THREE.PlaneGeometry(
      params.areaWidth,
      params.areaHeight,
      1,
      1,
    );
    const seeds = new Float32Array(count);
    const colorMixes = new Float32Array(count);

    fogPlanes = new THREE.InstancedMesh(geometry, material, count);
    fogPlanes.name = "DenseFogPlanes";
    fogPlanes.frustumCulled = false;
    fogPlanes.renderOrder = 10;

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const z = THREE.MathUtils.lerp(params.startZ, params.endZ, t);

      dummy.position.set(
        params.centerX + (Math.random() - 0.5) * 1.5,
        params.centerY + (Math.random() - 0.5) * 1.5,
        z,
      );
      dummy.rotation.set(0, 0, (Math.random() - 0.5) * 0.4);
      dummy.scale.setScalar(0.95 + Math.random() * 0.25);
      dummy.updateMatrix();

      fogPlanes.setMatrixAt(i, dummy.matrix);
      seeds[i] = Math.random() * 100.0;
      colorMixes[i] = THREE.MathUtils.clamp(
        t * 0.6 + Math.random() * 0.4,
        0,
        1,
      );
    }

    geometry.setAttribute(
      "aSeed",
      new THREE.InstancedBufferAttribute(seeds, 1),
    );
    geometry.setAttribute(
      "aColorMix",
      new THREE.InstancedBufferAttribute(colorMixes, 1),
    );
    fogPlanes.instanceMatrix.needsUpdate = true;

    scene.add(fogPlanes);
  }

  // Debug volume box/lines matching [startZ, endZ], areaWidth, areaHeight, centerX, centerY
  const debugLineMat = new THREE.LineBasicMaterial({
    color: params.debugColor,
  });
  const debugLineGeo = new THREE.BufferGeometry();
  const debugLines = new THREE.LineSegments(debugLineGeo, debugLineMat);
  debugLines.name = "DenseFogAreaDebug";
  scene.add(debugLines);

  function updateDebugLines() {
    debugLines.visible = params.showDebug;
    if (!params.showDebug) return;

    debugLineMat.color.set(params.debugColor);

    const halfW = params.areaWidth * 0.5;
    const halfH = params.areaHeight * 0.5;
    const x0 = params.centerX - halfW;
    const x1 = params.centerX + halfW;
    const y0 = params.centerY - halfH;
    const y1 = params.centerY + halfH;
    const z0 = params.startZ;
    const z1 = params.endZ;

    const corners = [
      new THREE.Vector3(x0, y0, z0), // 0
      new THREE.Vector3(x1, y0, z0), // 1
      new THREE.Vector3(x1, y1, z0), // 2
      new THREE.Vector3(x0, y1, z0), // 3
      new THREE.Vector3(x0, y0, z1), // 4
      new THREE.Vector3(x1, y0, z1), // 5
      new THREE.Vector3(x1, y1, z1), // 6
      new THREE.Vector3(x0, y1, z1), // 7
    ];

    const edges = [
      0,
      1,
      1,
      2,
      2,
      3,
      3,
      0, // startZ rectangle
      4,
      5,
      5,
      6,
      6,
      7,
      7,
      4, // endZ rectangle
      0,
      4,
      1,
      5,
      2,
      6,
      3,
      7, // connecting rails along Z
    ];

    const positions = new Float32Array(edges.length * 3);
    edges.forEach((cornerIdx, i) => {
      const v = corners[cornerIdx];
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    });

    debugLineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    debugLineGeo.computeBoundingSphere();
  }

  function syncUniforms() {
    scene.fog.density = params.fogDensity;
    material.uniforms.uOpacity.value = params.opacity;
    material.uniforms.uNoiseScale.value = params.noiseScale;
    material.uniforms.uSpeed.value = params.driftSpeed;
    material.uniforms.uCloudThreshold.value = params.cloudThreshold;
    material.uniforms.uCloudContrast.value = params.cloudContrast;
    material.uniforms.uNoiseMode.value = params.noiseMode === "billowy" ? 1 : 0;
    material.uniforms.uColorA.value.set(params.baseColor);
    material.uniforms.uColorB.value.set(params.scatterColor);
    material.uniforms.uStartZ.value = params.startZ;
    material.uniforms.uEndZ.value = params.endZ;
    material.uniforms.uEdgeSoftness.value = params.edgeSoftness;
    material.uniforms.uProgressStartOpacity.value = params.progressStartOpacity;
    material.uniforms.uProgressEndOpacity.value = params.progressEndOpacity;
    material.uniforms.uProgressCurve.value = params.progressCurve;
    material.uniforms.uProgressWeight.value = params.progressWeight;
    if (params.syncBackground && scene.background instanceof THREE.Color) {
      scene.background.set(params.baseColor);
    }
  }

  rebuildFogPlanes();
  updateDebugLines();

  if (pane) {
    const fogFolder = pane.addFolder({ title: "Fog" });

    fogFolder
      .addBinding(params, "fogDensity", {
        label: "exp2 density",
        min: 0,
        max: 0.25,
        step: 0.001,
      })
      .on("change", syncUniforms);
    fogFolder
      .addBinding(params, "baseColor", { label: "base color" })
      .on("change", (ev) => {
        scene.fog.color.set(ev.value);
        syncUniforms();
      });
    fogFolder
      .addBinding(params, "scatterColor", { label: "scatter color" })
      .on("change", syncUniforms);
    fogFolder
      .addBinding(params, "syncBackground", { label: "sync bg" })
      .on("change", syncUniforms);

    const areaFolder = fogFolder.addFolder({ title: "Dense Area (World)" });
    areaFolder
      .addBinding(params, "startZ", {
        label: "start z",
        min: 0,
        max: 50,
        step: 0.5,
      })
      .on("change", () => {
        syncUniforms();
        rebuildFogPlanes();
        updateDebugLines();
      });
    areaFolder
      .addBinding(params, "endZ", {
        label: "end z",
        min: 0,
        max: 50,
        step: 0.5,
      })
      .on("change", () => {
        syncUniforms();
        rebuildFogPlanes();
        updateDebugLines();
      });
    areaFolder
      .addBinding(params, "areaWidth", {
        label: "area width",
        min: 1,
        max: 20,
        step: 0.5,
      })
      .on("change", () => {
        rebuildFogPlanes();
        updateDebugLines();
      });
    areaFolder
      .addBinding(params, "areaHeight", {
        label: "area height",
        min: 1,
        max: 20,
        step: 0.5,
      })
      .on("change", () => {
        rebuildFogPlanes();
        updateDebugLines();
      });
    areaFolder
      .addBinding(params, "centerX", {
        label: "center x",
        min: -60,
        max: 60,
        step: 0.5,
      })
      .on("change", () => {
        rebuildFogPlanes();
        updateDebugLines();
      });
    areaFolder
      .addBinding(params, "centerY", {
        label: "center y",
        min: -40,
        max: 60,
        step: 0.5,
      })
      .on("change", () => {
        rebuildFogPlanes();
        updateDebugLines();
      });
    areaFolder
      .addBinding(params, "edgeSoftness", {
        label: "z fade softness",
        min: 0.5,
        max: 30,
        step: 0.5,
      })
      .on("change", syncUniforms);

    const progressFolder = fogFolder.addFolder({
      title: "Progress Opacity (startZ -> endZ)",
    });
    progressFolder
      .addBinding(params, "progressWeight", {
        label: "progress mix",
        min: 0,
        max: 1,
        step: 0.01,
      })
      .on("change", syncUniforms);
    progressFolder
      .addBinding(params, "progressStartOpacity", {
        label: "start opacity",
        min: 0,
        max: 2,
        step: 0.01,
      })
      .on("change", syncUniforms);
    progressFolder
      .addBinding(params, "progressEndOpacity", {
        label: "end opacity",
        min: 0,
        max: 2,
        step: 0.01,
      })
      .on("change", syncUniforms);
    progressFolder
      .addBinding(params, "progressCurve", {
        label: "curve exponent",
        min: 0.1,
        max: 4,
        step: 0.05,
      })
      .on("change", syncUniforms);

    const styleFolder = fogFolder.addFolder({ title: "Dense Fog & Noise" });
    styleFolder
      .addBinding(params, "noiseMode", {
        label: "noise algo",
        options: {
          "Value FBM (Warped)": "valueFbm",
          "Billowy Clouds": "billowy",
        },
      })
      .on("change", syncUniforms);
    styleFolder
      .addBinding(params, "planeCount", {
        label: "plane count",
        min: 1,
        max: 100,
        step: 1,
      })
      .on("change", rebuildFogPlanes);
    styleFolder
      .addBinding(params, "opacity", {
        label: "opacity",
        min: 0,
        max: 0.75,
        step: 0.005,
      })
      .on("change", syncUniforms);
    styleFolder
      .addBinding(params, "cloudThreshold", {
        label: "cloud threshold",
        min: 0,
        max: 0.8,
        step: 0.01,
      })
      .on("change", syncUniforms);
    styleFolder
      .addBinding(params, "cloudContrast", {
        label: "cloud contrast",
        min: 0.05,
        max: 0.8,
        step: 0.01,
      })
      .on("change", syncUniforms);
    styleFolder
      .addBinding(params, "noiseScale", {
        label: "noise scale",
        min: 0.5,
        max: 8,
        step: 0.1,
      })
      .on("change", syncUniforms);
    styleFolder
      .addBinding(params, "driftSpeed", {
        label: "drift speed",
        min: 0,
        max: 0.5,
        step: 0.01,
      })
      .on("change", syncUniforms);
    styleFolder
      .addBinding(params, "additive", { label: "additive" })
      .on("change", (ev) => {
        material.blending = ev.value
          ? THREE.AdditiveBlending
          : THREE.NormalBlending;
        material.needsUpdate = true;
      });

    const debugFolder = fogFolder.addFolder({ title: "Debug Area" });
    debugFolder
      .addBinding(params, "showDebug", { label: "show debug" })
      .on("change", updateDebugLines);
    debugFolder
      .addBinding(params, "debugColor", { label: "debug color" })
      .on("change", updateDebugLines);
  }

  return {
    get mesh() {
      return fogPlanes;
    },
    debugLines,
    material,
    params,
    rebuild: rebuildFogPlanes,
    updateDebugLines,
    update(elapsedTime) {
      material.uniforms.uTime.value = elapsedTime;
    },
    dispose() {
      if (fogPlanes) {
        scene.remove(fogPlanes);
        fogPlanes.geometry.dispose();
      }
      scene.remove(debugLines);
      debugLineGeo.dispose();
      debugLineMat.dispose();
      material.dispose();
    },
  };
}

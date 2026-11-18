import * as THREE from 'three';
import { ResourceManager } from '@/src/core/ResourceManager';
import { LightingTime } from '@/src/schemas/common.schema';
import { getMissionVisualProfile } from './VisualBible';

export interface SceneLights {
  sun: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  rim: THREE.DirectionalLight;
  skyDome: THREE.Mesh;
  updateShadowFocus: (focusX: number, focusY: number, focusZ: number, shadowDistance: number) => void;
  dispose: () => void;
}

const SKY_DOME_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDirection;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldDirection = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SKY_DOME_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uGroundColor;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunDiskIntensity;
  uniform float uStarIntensity;
  uniform float uFoundryGlowIntensity;
  varying vec3 vWorldDirection;

  float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 dir = normalize(vWorldDirection);
    float y = dir.y;

    // Upper hemisphere Rayleigh/Mie horizon-to-zenith gradient
    float upperT = pow(clamp(y, 0.0, 1.0), 0.52);
    vec3 skyCol = mix(uHorizonColor, uZenithColor, upperT);

    // Lower hemisphere ground bounce
    float lowerT = clamp(-y * 3.0, 0.0, 1.0);
    skyCol = mix(skyCol, uGroundColor, lowerT);

    // Horizon atmospheric scattering band
    float horizonBand = exp(-abs(y) * 7.5);
    skyCol += uHorizonColor * horizonBand * 0.22;

    // Solar / Lunar disk & Mie forward scattering aureole
    float sunCos = max(0.0, dot(dir, normalize(uSunDirection)));
    float mieHalo = pow(sunCos, 12.0) * 0.35 + pow(sunCos, 96.0) * 0.55;
    float sunDisk = smoothstep(0.9982, 0.9996, sunCos) * uSunDiskIntensity;
    skyCol += uSunColor * (mieHalo + sunDisk);

    // Nocturnal starfield (Mission 3 Nightfall)
    if (uStarIntensity > 0.01 && y > 0.08) {
      vec3 starCell = floor(dir * 260.0);
      float starVal = hash31(starCell);
      if (starVal > 0.9945) {
        float twinkle = (starVal - 0.9945) / 0.0055;
        skyCol += vec3(0.82, 0.9, 1.0) * twinkle * uStarIntensity * smoothstep(0.08, 0.35, y);
      }
    }

    // Molten Foundry Horizon Under-Glow (Mission 5 Zero Hour)
    if (uFoundryGlowIntensity > 0.01) {
      float glowMask = exp(-max(0.0, y + 0.04) * 5.2) * (0.65 + 0.35 * sin(dir.x * 5.0 + dir.z * 3.0));
      skyCol += vec3(1.0, 0.36, 0.08) * glowMask * uFoundryGlowIntensity;
    }

    gl_FragColor = vec4(skyCol, 1.0);
  }
`;

export function setupLightingRig(
  scene: THREE.Scene,
  lighting: LightingTime,
  shadowMapSize: number,
  shadowDistance: number,
  resourceManager: ResourceManager,
  missionId?: number
): SceneLights {
  const presets: Record<
    LightingTime,
    {
      zenith: number;
      horizon: number;
      ground: number;
      fog: number;
      fogDensity: number;
      sunColor: number;
      sunInt: number;
      sunPos: [number, number, number];
      hemiSky: number;
      hemiGround: number;
      hemiInt: number;
      rimColor: number;
      starIntensity: number;
      foundryGlow: number;
    }
  > = {
    daylight: {
      zenith: 0x3b76ad,
      horizon: 0xe6c294,
      ground: 0x6e5a44,
      fog: 0xd2b896,
      fogDensity: 0.0024,
      sunColor: 0xfff0d4,
      sunInt: 2.55,
      sunPos: [65, 95, 45],
      hemiSky: 0x9ec5e8,
      hemiGround: 0x5c4a38,
      hemiInt: 0.95,
      rimColor: 0x67e8f9,
      starIntensity: 0,
      foundryGlow: 0,
    },
    sunset: {
      zenith: 0x2b425c,
      horizon: 0xe8a87c,
      ground: 0x453832,
      fog: 0xb88668,
      fogDensity: 0.0029,
      sunColor: 0xffb677,
      sunInt: 2.45,
      sunPos: [-85, 42, -50],
      hemiSky: 0xf59e6c,
      hemiGround: 0x452f20,
      hemiInt: 0.9,
      rimColor: 0x38bdf8,
      starIntensity: 0.12,
      foundryGlow: 0.15,
    },
    night: {
      zenith: 0x071021,
      horizon: 0x1b314f,
      ground: 0x0d1522,
      fog: 0x112036,
      fogDensity: 0.0032,
      sunColor: 0x9ec5ff,
      sunInt: 1.48,
      sunPos: [44, 82, -62],
      hemiSky: 0x2e4c7d,
      hemiGround: 0x141d29,
      hemiInt: 0.76,
      rimColor: 0xf59e0b,
      starIntensity: 0.95,
      foundryGlow: 0,
    },
    misty_dawn: {
      zenith: 0x264e4a,
      horizon: 0x88b097,
      ground: 0x2d4228,
      fog: 0x638573,
      fogDensity: 0.0034,
      sunColor: 0xffe4b5,
      sunInt: 2.15,
      sunPos: [58, 64, 60],
      hemiSky: 0x95b8ac,
      hemiGround: 0x2a3822,
      hemiInt: 0.96,
      rimColor: 0x93c5fd,
      starIntensity: 0,
      foundryGlow: 0,
    },
    storm_dusk: {
      zenith: 0x1c1926,
      horizon: 0x7c3a2b,
      ground: 0x361e16,
      fog: 0x3d2a26,
      fogDensity: 0.0031,
      sunColor: 0xffa366,
      sunInt: 2.08,
      sunPos: [-62, 52, 48],
      hemiSky: 0x5c4f63,
      hemiGround: 0x382018,
      hemiInt: 0.86,
      rimColor: 0xf97316,
      starIntensity: 0.25,
      foundryGlow: 0.68,
    },
  };

  const p = { ...presets[lighting] };
  if (missionId !== undefined) {
    const vp = getMissionVisualProfile(missionId);
    p.zenith = vp.skyZenithColorHex;
    p.horizon = vp.skyHorizonColorHex;
    p.ground = vp.skyGroundBounceHex;
    p.fog = vp.fogColorHex;
    p.fogDensity = vp.fogBaseDensity;
    p.sunColor = vp.sunLightColorHex;
    p.sunInt = vp.sunLightIntensity;
    if (missionId === 3) p.starIntensity = 1.0;
    if (missionId === 5) p.foundryGlow = 0.72;
  }

  scene.background = new THREE.Color(p.horizon);
  scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);

  const baseSunPos = new THREE.Vector3(...p.sunPos);
  const sunDirNorm = baseSunPos.clone().normalize();

  // Atmospheric Sky Dome Mesh
  const skyGeo = new THREE.SphereGeometry(460, 28, 16);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_DOME_VERTEX_SHADER,
    fragmentShader: SKY_DOME_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenithColor: { value: new THREE.Color(p.zenith) },
      uHorizonColor: { value: new THREE.Color(p.horizon) },
      uGroundColor: { value: new THREE.Color(p.ground) },
      uSunDirection: { value: sunDirNorm },
      uSunColor: { value: new THREE.Color(p.sunColor) },
      uSunDiskIntensity: { value: lighting === 'night' ? 0.9 : 1.65 },
      uStarIntensity: { value: p.starIntensity },
      uFoundryGlowIntensity: { value: p.foundryGlow },
    },
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.name = 'atmospheric_sky_dome';
  skyDome.frustumCulled = false;
  skyDome.renderOrder = -1000;
  scene.add(skyDome);

  const fill = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiInt);
  fill.position.set(0, 65, 0);
  scene.add(fill);

  const sun = new THREE.DirectionalLight(p.sunColor, p.sunInt);
  sun.position.set(...p.sunPos);
  sun.castShadow = shadowMapSize >= 512;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 260;
  sun.shadow.camera.left = -shadowDistance;
  sun.shadow.camera.right = shadowDistance;
  sun.shadow.camera.top = shadowDistance;
  sun.shadow.camera.bottom = -shadowDistance;
  sun.shadow.bias = -0.00045;
  sun.shadow.normalBias = 0.024;
  scene.add(sun);
  scene.add(sun.target);

  const sunForward = baseSunPos.clone().negate().normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const sunRight = new THREE.Vector3().crossVectors(sunForward, worldUp);
  if (sunRight.lengthSq() < 1e-6) {
    sunRight.set(1, 0, 0);
  } else {
    sunRight.normalize();
  }
  const sunUp = new THREE.Vector3().crossVectors(sunRight, sunForward).normalize();
  const scratchFocus = new THREE.Vector3();
  const scratchSnappedTarget = new THREE.Vector3();

  const updateShadowFocus = (
    focusX: number,
    focusY: number,
    focusZ: number,
    activeShadowDistance: number
  ): void => {
    skyDome.position.set(focusX, 0, focusZ);
    if (!sun.castShadow || sun.shadow.mapSize.x < 512 || activeShadowDistance <= 0) return;

    const mapSize = sun.shadow.mapSize.x;
    const texelSize = (activeShadowDistance * 2) / mapSize;
    if (
      Math.abs(sun.shadow.camera.right - activeShadowDistance) > 0.01 ||
      Math.abs(sun.shadow.camera.left + activeShadowDistance) > 0.01
    ) {
      sun.shadow.camera.left = -activeShadowDistance;
      sun.shadow.camera.right = activeShadowDistance;
      sun.shadow.camera.top = activeShadowDistance;
      sun.shadow.camera.bottom = -activeShadowDistance;
      sun.shadow.camera.updateProjectionMatrix();
    }

    scratchFocus.set(focusX, focusY, focusZ);
    const snappedRight = Math.round(scratchFocus.dot(sunRight) / texelSize) * texelSize;
    const snappedUp = Math.round(scratchFocus.dot(sunUp) / texelSize) * texelSize;
    const depthStep = Math.max(1, texelSize * 8);
    const forwardProj = Math.round(scratchFocus.dot(sunForward) / depthStep) * depthStep;

    scratchSnappedTarget
      .set(0, 0, 0)
      .addScaledVector(sunRight, snappedRight)
      .addScaledVector(sunUp, snappedUp)
      .addScaledVector(sunForward, forwardProj);

    sun.target.position.copy(scratchSnappedTarget);
    sun.position.copy(scratchSnappedTarget).add(baseSunPos);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  };

  updateShadowFocus(0, 0, 0, shadowDistance);

  const rim = new THREE.DirectionalLight(p.rimColor, 0.62);
  rim.position.set(-p.sunPos[0], 48, -p.sunPos[2]);
  scene.add(rim);

  const dispose = () => {
    scene.remove(skyDome);
    skyGeo.dispose();
    skyMat.dispose();
    scene.remove(fill);
    scene.remove(sun);
    scene.remove(sun.target);
    scene.remove(rim);
    sun.shadow.map?.dispose();
  };

  resourceManager.register('other', 'mission:lights', dispose);
  return { sun, fill, rim, skyDome, updateShadowFocus, dispose };
}


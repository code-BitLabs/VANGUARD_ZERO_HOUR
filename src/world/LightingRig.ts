import * as THREE from 'three';
import { LightingTime } from '@/src/schemas/common.schema';
import { ResourceManager } from '@/src/core/ResourceManager';

export interface SceneLights {
  sun: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  rim: THREE.DirectionalLight;
  dispose: () => void;
}

export function setupLightingRig(
  scene: THREE.Scene,
  lighting: LightingTime,
  shadowMapSize: number,
  shadowDistance: number,
  resourceManager: ResourceManager
): SceneLights {
  const presets: Record<
    LightingTime,
    {
      sky: number;
      fog: number;
      fogDensity: number;
      sunColor: number;
      sunInt: number;
      sunPos: [number, number, number];
      hemiSky: number;
      hemiGround: number;
      hemiInt: number;
      rimColor: number;
    }
  > = {
    daylight: {
      sky: 0x7b8ea3,
      fog: 0x728396,
      fogDensity: 0.0042,
      sunColor: 0xfff0d4,
      sunInt: 2.35,
      sunPos: [65, 95, 45],
      hemiSky: 0x9ec5e8,
      hemiGround: 0x3b3a34,
      hemiInt: 0.9,
      rimColor: 0x67e8f9,
    },
    sunset: {
      sky: 0xb96838,
      fog: 0x9d5b3a,
      fogDensity: 0.0052,
      sunColor: 0xff9a44,
      sunInt: 2.6,
      sunPos: [-85, 38, -50],
      hemiSky: 0xf59e6c,
      hemiGround: 0x452f20,
      hemiInt: 0.85,
      rimColor: 0x38bdf8,
    },
    night: {
      sky: 0x090f1a,
      fog: 0x0b1220,
      fogDensity: 0.0075,
      sunColor: 0x6ea8fe,
      sunInt: 1.15,
      sunPos: [40, 80, -60],
      hemiSky: 0x243b61,
      hemiGround: 0x10141a,
      hemiInt: 0.62,
      rimColor: 0xf59e0b,
    },
    misty_dawn: {
      sky: 0x5c766d,
      fog: 0x4e675e,
      fogDensity: 0.0068,
      sunColor: 0xfde2b8,
      sunInt: 1.95,
      sunPos: [55, 62, 60],
      hemiSky: 0x89aba0,
      hemiGround: 0x26311f,
      hemiInt: 0.92,
      rimColor: 0x93c5fd,
    },
    storm_dusk: {
      sky: 0x26303d,
      fog: 0x212a35,
      fogDensity: 0.0064,
      sunColor: 0xfbbf77,
      sunInt: 1.75,
      sunPos: [-60, 52, 48],
      hemiSky: 0x4b5c70,
      hemiGround: 0x1a1e24,
      hemiInt: 0.78,
      rimColor: 0x22d3ee,
    },
  };

  const p = presets[lighting];
  scene.background = new THREE.Color(p.sky);
  scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);

  const fill = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiInt);
  fill.position.set(0, 60, 0);
  scene.add(fill);

  const sun = new THREE.DirectionalLight(p.sunColor, p.sunInt);
  sun.position.set(...p.sunPos);
  sun.castShadow = shadowMapSize >= 512;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 240;
  sun.shadow.camera.left = -shadowDistance;
  sun.shadow.camera.right = shadowDistance;
  sun.shadow.camera.top = shadowDistance;
  sun.shadow.camera.bottom = -shadowDistance;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);
  scene.add(sun.target);

  const rim = new THREE.DirectionalLight(p.rimColor, 0.55);
  rim.position.set(-p.sunPos[0], 45, -p.sunPos[2]);
  scene.add(rim);

  const dispose = () => {
    scene.remove(fill);
    scene.remove(sun);
    scene.remove(sun.target);
    scene.remove(rim);
    sun.shadow.map?.dispose();
  };

  resourceManager.register('other', 'mission:lights', dispose);
  return { sun, fill, rim, dispose };
}

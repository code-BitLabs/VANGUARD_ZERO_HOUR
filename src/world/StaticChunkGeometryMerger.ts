import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { WorldChunkManager } from './WorldChunkManager';

export interface StaticChunkMergeStats {
  readonly sourceMeshesMerged: number;
  readonly mergedMeshesCreated: number;
  readonly chunkBvhsRegistered: number;
}

const MIN_BVH_TRIANGLES = 48;

function isProtectedFromMerge(obj: THREE.Object3D, stopAt: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur && cur !== stopAt) {
    const ud = cur.userData;
    if (ud && (ud.noMerge || ud.isDestructible || ud.dynamicPlatform || ud.isAnimated)) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

function normalizeGeometryForMerge(
  sourceGeo: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4
): THREE.BufferGeometry | null {
  const posAttr = sourceGeo.getAttribute('position');
  if (!posAttr || posAttr.count < 3) return null;

  const nonIndexed = sourceGeo.index ? sourceGeo.toNonIndexed() : sourceGeo.clone();
  nonIndexed.applyMatrix4(worldMatrix);

  const count = nonIndexed.getAttribute('position').count;
  if (!nonIndexed.getAttribute('normal')) {
    nonIndexed.computeVertexNormals();
  }
  if (!nonIndexed.getAttribute('uv')) {
    nonIndexed.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }

  // Strip optional/extra attributes (e.g. tangent, color, uv1) so BufferGeometryUtils.mergeGeometries
  // always receives homogeneous [position, normal, uv] attribute layouts across Box/Cylinder/Sphere primitives.
  for (const attrName of Object.keys(nonIndexed.attributes)) {
    if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
      nonIndexed.deleteAttribute(attrName);
    }
  }
  nonIndexed.morphAttributes = {};
  return nonIndexed;
}

/**
 * Merges static, non-destructible, non-animated meshes within each WorldChunkManager chunk
 * by `(material.uuid, castShadow, receiveShadow)` using Three.js `BufferGeometryUtils.mergeGeometries`.
 * - Cuts M1 static draw calls from ~350+ down to ~25-45 while keeping chunk frustum culling intact.
 * - Preserves `colliderMeshes` lookup references for surface impact material classification.
 * - Registers chunk-level BVHs only for complex merged meshes (>48 triangles) to slash BVH count & build cost.
 */
export function mergeStaticChunkGeometry(
  chunkManager: WorldChunkManager,
  resourceManager: ResourceManager,
  scope: ResourceScope,
  collisionWorld: CollisionWorld,
  colliderMeshes?: Map<string, THREE.Mesh>
): StaticChunkMergeStats {
  let sourceMeshesMerged = 0;
  let mergedMeshesCreated = 0;
  let chunkBvhsRegistered = 0;
  const replacementMap = new Map<THREE.Mesh, THREE.Mesh>();

  for (const chunk of chunkManager.getChunks()) {
    chunk.group.updateMatrixWorld(true);

    const buckets = new Map<
      string,
      {
        material: THREE.Material;
        castShadow: boolean;
        receiveShadow: boolean;
        meshes: THREE.Mesh[];
        anyBvhCandidate: boolean;
      }
    >();

    chunk.group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj instanceof THREE.InstancedMesh) return;
      if (Array.isArray(obj.material) || !obj.material) return;
      if (isProtectedFromMerge(obj, chunk.group)) return;
      if (!obj.geometry?.getAttribute('position')) return;

      const key = `${obj.material.uuid}|${obj.castShadow ? 1 : 0}|${obj.receiveShadow ? 1 : 0}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          material: obj.material,
          castShadow: obj.castShadow,
          receiveShadow: obj.receiveShadow,
          meshes: [],
          anyBvhCandidate: false,
        };
        buckets.set(key, bucket);
      }
      bucket.meshes.push(obj);
      if (!obj.userData?.skipBvh) {
        bucket.anyBvhCandidate = true;
      }
    });

    const parentsToPrune = new Set<THREE.Object3D>();

    for (const bucket of buckets.values()) {
      if (bucket.meshes.length < 2) {
        // Leave single-mesh buckets untouched; register BVH only if complex (>48 tris)
        const solo = bucket.meshes[0];
        if (solo && bucket.anyBvhCandidate && !solo.userData?.skipBvh) {
          const triCount = solo.geometry.index
            ? solo.geometry.index.count / 3
            : solo.geometry.getAttribute('position').count / 3;
          if (triCount > MIN_BVH_TRIANGLES) {
            collisionWorld.physicsWorld.registerBvhMesh(solo);
            chunkBvhsRegistered++;
          }
        }
        continue;
      }

      const normalizedGeos: THREE.BufferGeometry[] = [];
      const includedMeshes: THREE.Mesh[] = [];
      for (let i = 0; i < bucket.meshes.length; i++) {
        const m = bucket.meshes[i];
        const norm = normalizeGeometryForMerge(m.geometry, m.matrixWorld);
        if (norm) {
          normalizedGeos.push(norm);
          includedMeshes.push(m);
        }
      }

      if (normalizedGeos.length < 2) {
        for (const g of normalizedGeos) g.dispose();
        continue;
      }

      const mergedGeo = mergeGeometries(normalizedGeos, false);
      for (const g of normalizedGeos) g.dispose();
      if (!mergedGeo) continue;

      mergedGeo.computeBoundingBox();
      mergedGeo.computeBoundingSphere();
      resourceManager.registerGeometry(mergedGeo, scope);

      const mergedMesh = new THREE.Mesh(mergedGeo, bucket.material);
      mergedMesh.name = `merged_chunk_${chunk.key}_${mergedMeshesCreated}`;
      mergedMesh.castShadow = bucket.castShadow;
      mergedMesh.receiveShadow = bucket.receiveShadow;
      mergedMesh.matrixAutoUpdate = false;
      mergedMesh.updateMatrix();
      if (includedMeshes[0]?.userData?.surfaceMaterial) {
        mergedMesh.userData.surfaceMaterial = includedMeshes[0].userData.surfaceMaterial;
      }

      chunk.group.add(mergedMesh);
      mergedMeshesCreated++;
      sourceMeshesMerged += includedMeshes.length;

      const preservedNames = new Set<string>();
      for (let i = 0; i < includedMeshes.length; i++) {
        const src = includedMeshes[i];
        replacementMap.set(src, mergedMesh);
        if (src.name && !preservedNames.has(src.name)) {
          preservedNames.add(src.name);
        }
        if (src.parent) {
          parentsToPrune.add(src.parent);
          src.parent.remove(src);
        }
      }
      // Keep one zero-draw-call Object3D semantic marker per unique merged part name so scene queries
      // (architectural trim inspection, diagnostics) remain intact without extra meshes or draw calls.
      for (const semanticName of preservedNames) {
        if (!chunk.group.getObjectByName(semanticName)) {
          const marker = new THREE.Object3D();
          marker.name = semanticName;
          marker.matrixAutoUpdate = false;
          marker.userData.mergedSemanticTag = true;
          chunk.group.add(marker);
        }
      }

      const triCount = mergedGeo.getAttribute('position').count / 3;
      if (bucket.anyBvhCandidate && triCount > MIN_BVH_TRIANGLES) {
        collisionWorld.physicsWorld.registerBvhMesh(mergedMesh);
        chunkBvhsRegistered++;
      }
    }

    // Prune empty static wrapper groups left behind after merging their child meshes
    for (const parent of parentsToPrune) {
      let cur: THREE.Object3D | null = parent;
      while (cur && cur !== chunk.group && cur.children.length === 0) {
        const nextParent: THREE.Object3D | null = cur.parent;
        nextParent?.remove(cur);
        cur = nextParent;
      }
    }
  }

  // Repoint any colliderMeshes references from removed child meshes to their replacement merged chunk mesh
  if (colliderMeshes && replacementMap.size > 0) {
    for (const [id, mesh] of colliderMeshes.entries()) {
      const replacement = replacementMap.get(mesh);
      if (replacement) {
        colliderMeshes.set(id, replacement);
      }
    }
  }

  return {
    sourceMeshesMerged,
    mergedMeshesCreated,
    chunkBvhsRegistered,
  };
}

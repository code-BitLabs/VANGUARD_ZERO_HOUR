import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Eye, RotateCcw } from 'lucide-react';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { WeaponSilhouette } from '@/src/ui/components/WeaponSilhouette';

export type ArmoryAttachmentSlot = 'optic' | 'muzzle' | 'barrel' | 'underbarrel' | 'magazine';

export type ArmoryCameraPreset = 'profile' | 'optic' | 'muzzle' | 'receiver';

interface PresetPose {
  label: string;
  yaw: number;
  pitch: number;
  distance: number;
  targetX: number;
  targetY: number;
}

const CAMERA_PRESETS: Record<ArmoryCameraPreset, PresetPose> = {
  profile: { label: 'Profile', yaw: 0.28, pitch: 0.14, distance: 2.35, targetX: 0.0, targetY: 0.02 },
  optic: { label: 'Optic', yaw: 0.85, pitch: 0.24, distance: 1.38, targetX: -0.05, targetY: 0.16 },
  muzzle: { label: 'Muzzle', yaw: -0.68, pitch: 0.1, distance: 1.45, targetX: 0.52, targetY: 0.04 },
  receiver: { label: 'Receiver', yaw: 0.42, pitch: 0.08, distance: 1.42, targetX: -0.08, targetY: -0.02 },
};

function buildProceduralWeaponRig(
  weaponId: WeaponId,
  equippedAttachments: Partial<Record<ArmoryAttachmentSlot, string | null>>
): { group: THREE.Group; disposables: Array<{ dispose: () => void }> } {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };

  const receiverMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: weaponId === 'sniper_rifle' ? 0x3b4238 : weaponId === 'pistol' ? 0x242a32 : 0x2b323b,
      roughness: 0.42,
      metalness: 0.78,
    })
  );
  const barrelMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.3, metalness: 0.88 })
  );
  const polymerMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.76, metalness: 0.15 })
  );
  const accentMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd99b26,
      roughness: 0.32,
      metalness: 0.72,
    })
  );

  const isLauncher =
    weaponId === 'rocket_launcher' ||
    weaponId === 'guided_missile' ||
    weaponId === 'grenade_launcher';
  const isPistol = weaponId === 'pistol';
  const isSniper = weaponId === 'sniper_rifle';
  const isLmg = weaponId === 'lmg';
  const isShotgun = weaponId === 'shotgun';

  const bodyLen = isPistol ? 0.56 : isSniper ? 1.05 : isLauncher ? 1.25 : 0.82;
  const barrelLen = isPistol ? 0.24 : isSniper ? 0.72 : isLauncher ? 0.65 : isShotgun ? 0.56 : 0.48;

  // Receiver / main chassis
  const receiver = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(bodyLen, isLauncher ? 0.16 : 0.15, isLauncher ? 0.16 : 0.11)),
    receiverMat
  );
  receiver.castShadow = true;
  group.add(receiver);

  // Picatinny top rail
  const rail = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(bodyLen * 0.85, 0.024, 0.055)),
    barrelMat
  );
  rail.position.set(0.02, 0.088, 0);
  group.add(rail);

  // Barrel / tube
  const barrel = new THREE.Mesh(
    trackGeo(
      new THREE.CylinderGeometry(
        isLauncher ? 0.062 : 0.022,
        isLauncher ? 0.062 : 0.026,
        barrelLen,
        14
      )
    ),
    barrelMat
  );
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(bodyLen * 0.5 + barrelLen * 0.45, 0.02, 0);
  group.add(barrel);

  // Handguard shroud
  if (!isPistol) {
    const handguard = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(barrelLen * 0.62, 0.11, 0.095)),
      polymerMat
    );
    handguard.position.set(bodyLen * 0.5 + barrelLen * 0.2, 0.01, 0);
    group.add(handguard);
  }

  // Stock
  if (!isPistol && !isLauncher) {
    const stock = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.42, 0.14, 0.08)), polymerMat);
    stock.position.set(-bodyLen * 0.5 - 0.18, -0.02, 0);
    group.add(stock);
  }

  // Pistol grip
  const grip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.095, 0.24, 0.072)), polymerMat);
  grip.position.set(-bodyLen * 0.22, -0.15, 0);
  grip.rotation.z = -0.22;
  group.add(grip);

  // Magazine (reflects extended / fast mag attachments)
  const hasExtendedMag = Boolean(equippedAttachments.magazine);
  if (!isLauncher && !isShotgun) {
    const magHeight = isLmg ? 0.24 : hasExtendedMag ? 0.34 : 0.25;
    const magWidth = isLmg ? 0.18 : 0.095;
    const mag = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(magWidth, magHeight, isLmg ? 0.16 : 0.068)),
      hasExtendedMag ? accentMat : polymerMat
    );
    mag.position.set(0.08, -0.16 - (magHeight - 0.25) * 0.5, 0);
    mag.rotation.z = isPistol ? -0.18 : 0.16;
    group.add(mag);
  }

  // Optic attachment visualization
  const opticId = equippedAttachments.optic;
  if (opticId || isSniper) {
    const isLongScope = isSniper || (opticId && opticId.includes('acog')) || (opticId && opticId.includes('scope'));
    const opticMesh = new THREE.Mesh(
      trackGeo(
        isLongScope
          ? new THREE.CylinderGeometry(0.04, 0.036, 0.34, 14)
          : new THREE.BoxGeometry(0.14, 0.085, 0.07)
      ),
      barrelMat
    );
    if (isLongScope) opticMesh.rotation.z = Math.PI / 2;
    opticMesh.position.set(-0.04, 0.145, 0);
    group.add(opticMesh);

    const lens = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.026, 12)),
      trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
        })
      )
    );
    lens.position.set(isLongScope ? 0.132 : 0.032, 0.145, 0);
    lens.rotation.y = Math.PI / 2;
    group.add(lens);
  }

  // Muzzle attachment visualization (suppressor / compensator)
  const muzzleId = equippedAttachments.muzzle;
  if (muzzleId) {
    const isSuppressor = muzzleId.includes('suppressor') || muzzleId.includes('silencer');
    const muzzle = new THREE.Mesh(
      trackGeo(
        new THREE.CylinderGeometry(
          isSuppressor ? 0.038 : 0.032,
          isSuppressor ? 0.038 : 0.032,
          isSuppressor ? 0.3 : 0.12,
          14
        )
      ),
      isSuppressor ? barrelMat : accentMat
    );
    muzzle.rotation.z = Math.PI / 2;
    muzzle.position.set(bodyLen * 0.5 + barrelLen + (isSuppressor ? 0.12 : 0.03), 0.02, 0);
    group.add(muzzle);
  }

  // Underbarrel grip visualization
  if (equippedAttachments.underbarrel && !isPistol) {
    const foregrip = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.024, 0.028, 0.17, 10)),
      accentMat
    );
    foregrip.position.set(bodyLen * 0.5 + barrelLen * 0.16, -0.11, 0);
    group.add(foregrip);
  }

  return { group, disposables };
}

export function ArmoryWeaponStage3D({
  weaponId,
  weaponName,
  subtitle,
  equippedAttachments,
  isSoftwareGl = false,
}: {
  weaponId: WeaponId;
  weaponName: string;
  subtitle: string;
  equippedAttachments: Partial<Record<ArmoryAttachmentSlot, string | null>>;
  isSoftwareGl?: boolean;
}) {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const [preset, setPreset] = useState<ArmoryCameraPreset>('profile');
  const [webglReady, setWebglReady] = useState(false);

  const poseRef = useRef({
    yaw: CAMERA_PRESETS.profile.yaw,
    pitch: CAMERA_PRESETS.profile.pitch,
    distance: CAMERA_PRESETS.profile.distance,
    targetX: CAMERA_PRESETS.profile.targetX,
    targetY: CAMERA_PRESETS.profile.targetY,
    targetYaw: CAMERA_PRESETS.profile.yaw,
    targetPitch: CAMERA_PRESETS.profile.pitch,
    targetDistance: CAMERA_PRESETS.profile.distance,
    dragging: false,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    const p = CAMERA_PRESETS[preset];
    poseRef.current.targetYaw = p.yaw;
    poseRef.current.targetPitch = p.pitch;
    poseRef.current.targetDistance = p.distance;
    poseRef.current.targetX = p.targetX;
    poseRef.current.targetY = p.targetY;
  }, [preset]);

  const stageRef = useRef<{
    scene: THREE.Scene;
    rigGroup: THREE.Group | null;
    disposables: Array<{ dispose: () => void }>;
  } | null>(null);

  useEffect(() => {
    const container = canvasHostRef.current;
    if (!container || isSoftwareGl) {
      setWebglReady(false);
      return;
    }

    // Headless jsdom guard: probe WebGL availability once per mount and immediately release the probe context
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      const testCanvas = document.createElement('canvas');
      const gl =
        testCanvas.getContext('webgl2') ||
        testCanvas.getContext('webgl') ||
        testCanvas.getContext('experimental-webgl');
      if (!gl) {
        setWebglReady(false);
        return;
      }
      (gl as WebGLRenderingContext).getExtension?.('WEBGL_lose_context')?.loseContext();
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      setWebglReady(false);
      return;
    }

    const initW = Math.max(240, container.clientWidth || 480);
    const initH = Math.max(180, container.clientHeight || 220);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(initW, initH);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, initW / initH, 0.1, 20);

    // Three-point studio workbench lighting (created once per mount)
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e2530, 1.15);
    const key = new THREE.DirectionalLight(0xfff4e0, 2.35);
    key.position.set(2.8, 3.2, 3.6);
    const fill = new THREE.DirectionalLight(0x94a3b8, 0.95);
    fill.position.set(-2.2, 0.8, 2.4);
    const rim = new THREE.DirectionalLight(0x38bdf8, 1.35);
    rim.position.set(-3.2, 1.8, -2.5);
    scene.add(hemi, key, fill, rim);

    // Subtle workbench plinth grid (created once per mount)
    const gridGeo = new THREE.PlaneGeometry(3.4, 1.6);
    const gridMat = new THREE.MeshStandardMaterial({
      color: 0x10151c,
      roughness: 0.72,
      metalness: 0.25,
    });
    const plinth = new THREE.Mesh(gridGeo, gridMat);
    plinth.rotation.x = -Math.PI / 2;
    plinth.position.y = -0.34;
    scene.add(plinth);

    stageRef.current = {
      scene,
      rigGroup: null,
      disposables: [],
    };
    setWebglReady(true);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!renderer) return;
        const w = Math.max(240, container.clientWidth || 480);
        const h = Math.max(180, container.clientHeight || 220);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      });
      resizeObserver.observe(container);
    }

    let rafId = 0;
    let disposed = false;
    const reducedMotion =
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

    const animate = () => {
      if (disposed) return;
      if (document.hidden) {
        rafId = 0;
        return;
      }
      rafId = window.requestAnimationFrame(animate);
      const st = poseRef.current;
      if (!st.dragging && !reducedMotion) {
        st.targetYaw += 0.0022;
      }
      st.yaw += (st.targetYaw - st.yaw) * 0.1;
      st.pitch += (st.targetPitch - st.pitch) * 0.1;
      st.distance += (st.targetDistance - st.distance) * 0.1;

      camera.position.set(
        st.targetX + Math.sin(st.yaw) * Math.cos(st.pitch) * st.distance,
        st.targetY + Math.sin(st.pitch) * st.distance,
        Math.cos(st.yaw) * Math.cos(st.pitch) * st.distance
      );
      camera.lookAt(st.targetX, st.targetY, 0);
      renderer?.render(scene, camera);
    };

    const onVisibilityChange = () => {
      if (!document.hidden && !disposed && rafId === 0) {
        rafId = window.requestAnimationFrame(animate);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    rafId = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      resizeObserver?.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
      const stage = stageRef.current;
      if (stage) {
        if (stage.rigGroup) {
          stage.scene.remove(stage.rigGroup);
        }
        for (const d of stage.disposables) d.dispose();
        stageRef.current = null;
      }
      scene.remove(plinth, hemi, key, fill, rim);
      gridGeo.dispose();
      gridMat.dispose();
      renderer?.dispose();
      if (renderer?.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [isSoftwareGl]);

  // Swap only the procedural weapon rig when weaponId or attachments change (zero WebGL context churn)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !webglReady) return;

    if (stage.rigGroup) {
      stage.scene.remove(stage.rigGroup);
      for (const d of stage.disposables) d.dispose();
      stage.rigGroup = null;
      stage.disposables = [];
    }

    const { group: rig, disposables } = buildProceduralWeaponRig(weaponId, equippedAttachments);
    stage.rigGroup = rig;
    stage.disposables = disposables;
    stage.scene.add(rig);
  }, [
    webglReady,
    weaponId,
    equippedAttachments.optic,
    equippedAttachments.muzzle,
    equippedAttachments.underbarrel,
    equippedAttachments.magazine,
  ]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    poseRef.current.dragging = true;
    poseRef.current.lastX = e.clientX;
    poseRef.current.lastY = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!poseRef.current.dragging) return;
    const dx = e.clientX - poseRef.current.lastX;
    const dy = e.clientY - poseRef.current.lastY;
    poseRef.current.lastX = e.clientX;
    poseRef.current.lastY = e.clientY;
    poseRef.current.targetYaw -= dx * 0.009;
    poseRef.current.targetPitch = Math.max(
      -0.35,
      Math.min(0.65, poseRef.current.targetPitch + dy * 0.007)
    );
  };

  const handlePointerUp = () => {
    poseRef.current.dragging = false;
  };

  return (
    <div
      data-testid="armory-weapon-stage"
      className="relative bg-[var(--vg-bg-recessed)] border border-[var(--vg-border-subtle)] rounded-sm overflow-hidden"
    >
      {/* Interactive 3D Canvas Host (isolated sibling) + Blueprint Fallback */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="w-full h-48 sm:h-56 cursor-grab active:cursor-grabbing relative flex items-center justify-center touch-none-surface"
        aria-label={`Interactive 3D weapon inspection stage for ${weaponName}`}
      >
        <div ref={canvasHostRef} className="absolute inset-0" />
        {!webglReady && (() => {
          const blueprintFocus: Record<
            ArmoryCameraPreset,
            { transform: string; zoneLabel: string }
          > = {
            profile: { transform: 'scale(1) translate(0%, 0%)', zoneLabel: 'FULL PROFILE' },
            optic: { transform: 'scale(1.55) translate(4%, 14%)', zoneLabel: 'OPTIC RAIL FOCUS' },
            muzzle: { transform: 'scale(1.6) translate(-22%, 2%)', zoneLabel: 'MUZZLE & BARREL FOCUS' },
            receiver: { transform: 'scale(1.45) translate(8%, 0%)', zoneLabel: 'RECEIVER & MAGWELL FOCUS' },
          };
          const focus = blueprintFocus[preset];
          return (
            <div className="relative z-10 flex flex-col items-center justify-between w-full h-full pointer-events-none pt-9 pb-2.5 px-6 text-center">
              <div className="flex-1 w-full overflow-hidden flex items-center justify-center">
                <div
                  className="transition-transform duration-300 ease-out"
                  style={{ transform: focus.transform }}
                >
                  <WeaponSilhouette
                    weaponId={weaponId}
                    className="w-52 sm:w-64 h-16 sm:h-20 text-[var(--vg-accent-amber)]"
                  />
                </div>
              </div>
              <div className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--vg-text-muted)] pt-1.5">
                2D Tactical Blueprint View · <span className="text-[var(--vg-accent-cyan)]">{focus.zoneLabel}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Top-Left Inspection Metadata */}
      <div className="absolute top-2.5 left-3 pointer-events-none">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vg-accent-cyan)]">
          {webglReady ? '3D Inspection Bench · Drag to Orbit' : 'Ballistic Specification Bench'}
        </div>
        <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--vg-text-secondary)]">
          {subtitle}
        </div>
      </div>

      {/* Bottom Camera Angle Preset Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-[var(--vg-border-subtle)] bg-[var(--vg-bg-panel)]/95">
        <div className="flex items-center gap-1.5" role="group" aria-label="Inspection camera angle presets">
          <Eye className="w-3.5 h-3.5 text-[var(--vg-text-muted)] mr-0.5" />
          {(Object.keys(CAMERA_PRESETS) as ArmoryCameraPreset[]).map((key) => {
            const active = preset === key;
            return (
              <button
                key={key}
                type="button"
                data-testid={`armory-angle-${key}`}
                onClick={() => setPreset(key)}
                className={`min-h-[32px] px-2.5 rounded-sm font-mono text-[10px] uppercase tracking-wider border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--vg-bg-elevated)] border-[var(--vg-accent-amber)] text-[var(--vg-accent-amber)]'
                    : 'bg-[var(--vg-bg-recessed)] border-[var(--vg-border-subtle)] text-[var(--vg-text-secondary)] hover:text-[var(--vg-text-primary)]'
                }`}
              >
                {CAMERA_PRESETS[key].label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setPreset('profile')}
          className="inline-flex items-center gap-1 min-h-[32px] px-2 font-mono text-[10px] uppercase tracking-wider text-[var(--vg-text-muted)] hover:text-[var(--vg-text-primary)] cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" /> Reset View
        </button>
      </div>
    </div>
  );
}

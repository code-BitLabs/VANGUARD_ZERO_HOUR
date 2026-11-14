import { gameSessionStore } from '@/src/stores/gameSessionStore';

class VanguardPerfPanel extends HTMLElement {
  private unsubscribe: (() => void) | null = null;
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>
        :host {
          position: fixed;
          top: 12px;
          right: 12px;
          z-index: 60;
          pointer-events: none;
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          color: #e4e4e7;
        }
        .panel {
          background: rgba(11, 14, 17, 0.92);
          border: 1px solid rgba(245, 158, 11, 0.55);
          border-radius: 3px;
          padding: 10px 12px;
          min-width: 240px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        }
        .title {
          color: #f59e0b;
          font-weight: 700;
          letter-spacing: 0.12em;
          margin-bottom: 6px;
          font-size: 10px;
        }
        .row {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          line-height: 1.45;
          font-variant-numeric: tabular-nums;
        }
        .lbl { color: #9ca3af; }
        .val { color: #f4f4f5; font-weight: 600; }
        .ok { color: #10b981; }
        .warn { color: #f59e0b; }
      </style>
      <div class="panel">
        <div class="title">ENGINE DIAGNOSTICS [F3]</div>
        <div id="rows"></div>
      </div>
    `;
  }

  connectedCallback(): void {
    this.renderMetrics();
    this.unsubscribe = gameSessionStore.subscribe(
      (s) => s.diagnostics,
      () => this.renderMetrics()
    );
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private renderMetrics(): void {
    const d = gameSessionStore.getState().diagnostics;
    const rowsEl = this.shadow.getElementById('rows');
    if (!rowsEl) return;

    const fpsCls = d.fps >= 50 ? 'ok' : 'warn';
    const low1 = d.fps1PercentLow ?? d.fps;
    const resStr =
      d.renderWidth && d.renderHeight ? `${d.renderWidth}×${d.renderHeight}` : '--';
    const memStr = d.memoryUsedMb != null ? `${d.memoryUsedMb} MB` : 'N/A';
    rowsEl.innerHTML = `
      <div class="row"><span class="lbl">FPS / 1% Low</span><span class="val ${fpsCls}">${d.fps} / ${low1} (${d.frameMs.toFixed(1)}ms)</span></div>
      <div class="row"><span class="lbl">Governor / Res</span><span class="val">${d.governorTier.toUpperCase()} ${Math.round(d.renderScale * 100)}% (${resStr})</span></div>
      <div class="row"><span class="lbl">Phys / AI / Game</span><span class="val">${d.physicsMs.toFixed(1)} / ${d.aiMs.toFixed(1)} / ${d.gameplayMs.toFixed(1)}ms</span></div>
      <div class="row"><span class="lbl">Draw Calls / Tris</span><span class="val">${d.drawCalls} / ${(d.triangles / 1000).toFixed(1)}k</span></div>
      <div class="row"><span class="lbl">Geo / Tex / Mem</span><span class="val">${d.activeGeometries} / ${d.activeTextures} / ${memStr}</span></div>
      <div class="row"><span class="lbl">Shared / Mission Res</span><span class="val">${d.activeSharedRes} / ${d.activeMissionRes}</span></div>
      <div class="row"><span class="lbl">VFX / Voices / AI</span><span class="val">${d.activePooledVfx} / ${d.activeAudioVoices} / ${d.activeEnemies}</span></div>
    `;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('vanguard-perf-panel')) {
  customElements.define('vanguard-perf-panel', VanguardPerfPanel);
}

export {};

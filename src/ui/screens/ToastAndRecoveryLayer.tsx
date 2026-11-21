import React, { useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { uiStore, useUIStore } from '@/src/stores/uiStore';

export function ToastAndRecoveryLayer() {
  const toast = useUIStore((s) => s.toast);
  const contextLost = useUIStore((s) => s.contextLost);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => uiStore.getState().clearToast(), 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  return (
    <>
      {contextLost && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6">
          <div className="max-w-md bg-[#141920] border border-amber-500 p-6 rounded-sm text-center">
            <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto mb-2" />
            <h3 className="font-display text-xl font-bold uppercase text-white">
              Restoring Graphics Context
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              WebGL context interruption detected. Rebuilding shaders and render targets...
            </p>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-[#141920] border border-amber-500/70 px-4 py-2.5 rounded-sm shadow-xl max-w-md">
          <div className="font-display text-xs font-bold uppercase text-amber-400">{toast.title}</div>
          {toast.description && <div className="text-xs text-zinc-300 mt-0.5">{toast.description}</div>}
        </div>
      )}
    </>
  );
}

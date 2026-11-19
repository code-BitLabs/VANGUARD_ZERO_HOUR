import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { AudioSettings, AudioSettingsSchema } from '@/src/schemas/settings.schema';
import { SettingsManager } from '@/src/storage/SettingsManager';

export interface AudioSettingsStoreState extends AudioSettings {
  updateAudio: (patch: Partial<AudioSettings>) => void;
  toggleMute: () => void;
  resetAudio: () => void;
}

const initial = SettingsManager.load().audio;

function persistAudio(audio: AudioSettings) {
  const current = SettingsManager.load();
  SettingsManager.save({ ...current, audio });
}

export const audioSettingsStore = createStore<AudioSettingsStoreState>()(
  subscribeWithSelector((set, get) => ({
    ...initial,
    updateAudio: (patch) => {
      const next: AudioSettings = {
        masterVolume: patch.masterVolume ?? get().masterVolume,
        musicVolume: patch.musicVolume ?? get().musicVolume,
        sfxVolume: patch.sfxVolume ?? get().sfxVolume,
        dialogueVolume: patch.dialogueVolume ?? get().dialogueVolume,
        ambienceVolume: patch.ambienceVolume ?? get().ambienceVolume,
        muted: patch.muted ?? get().muted,
        musicEnabled: patch.musicEnabled ?? get().musicEnabled,
        musicTrackId: patch.musicTrackId ?? get().musicTrackId,
        musicShuffle: patch.musicShuffle ?? get().musicShuffle,
        musicRepeatMode: patch.musicRepeatMode ?? get().musicRepeatMode,
      };
      set(next);
      persistAudio(next);
    },
    toggleMute: () => {
      const nextMuted = !get().muted;
      get().updateAudio({ muted: nextMuted });
    },
    resetAudio: () => {
      const def = AudioSettingsSchema.parse({});
      set(def);
      persistAudio(def);
    },
  }))
);

export function useAudioSettingsStore<T>(selector: (state: AudioSettingsStoreState) => T): T {
  return useStore(audioSettingsStore, selector);
}

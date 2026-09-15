import { invoke } from '@tauri-apps/api/core';
import { listen, TauriEvent } from '@tauri-apps/api/event';

// Keep only the window operations used by this single-main-window application.
// Tauri's window commands resolve an omitted label to the invoking window;
// event targeting matches the main window in tauri.conf.json/capabilities.
// These are existing framework commands, not new application IPC contracts.
export function isCurrentWindowFullscreen(): Promise<boolean> {
  return invoke<boolean>('plugin:window|is_fullscreen');
}

export function setCurrentWindowFullscreen(value: boolean): Promise<void> {
  return invoke<void>('plugin:window|set_fullscreen', { value });
}

export function onMainWindowResized(callback: () => void): Promise<() => void> {
  return listen(TauriEvent.WINDOW_RESIZED, callback, {
    target: { kind: 'Window', label: 'main' },
  });
}

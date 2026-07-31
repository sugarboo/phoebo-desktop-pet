import { getCurrentWindow } from "@tauri-apps/api/window";

// This module is the narrow frontend-to-Tauri boundary. Rendering and animation
// code therefore remain ordinary browser TypeScript and can be unit-tested without
// knowing about native windows.
const petWindow = getCurrentWindow();

export function showPetWindow(): Promise<void> {
  return petWindow.show();
}

export function startPetWindowDragging(): Promise<void> {
  return petWindow.startDragging();
}

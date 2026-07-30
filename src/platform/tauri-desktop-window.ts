import { getCurrentWindow } from "@tauri-apps/api/window";

const petWindow = getCurrentWindow();

export function showPetWindow(): Promise<void> {
  return petWindow.show();
}

export function startPetWindowDragging(): Promise<void> {
  return petWindow.startDragging();
}


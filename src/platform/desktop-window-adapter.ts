/**
 * The small window surface the application layer is allowed to use.
 *
 * Keeping this contract independent from Tauri prevents animation and behavior
 * modules from learning about native handles, monitors, or IPC command names.
 */
export interface DesktopWindowAdapter {
  show(): Promise<void>;
  hide(): Promise<void>;
  setAlwaysOnTop(enabled: boolean): Promise<void>;
  startDragging(): Promise<void>;
  resetToReachablePosition(): Promise<void>;
}

export type DesktopControlEvent =
  | { readonly kind: "behavior-paused"; readonly paused: boolean }
  | { readonly kind: "window-visible"; readonly visible: boolean };

export type StopDesktopControlSubscription = () => void;

/**
 * Native tray actions arrive asynchronously from Rust. The source is a separate
 * seam from window operations so tests can drive lifecycle state without Tauri.
 */
export interface DesktopControlSource {
  readInitialBehaviorPaused(): Promise<boolean>;
  subscribe(
    listener: (event: DesktopControlEvent) => void,
  ): Promise<StopDesktopControlSubscription>;
}

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  DesktopControlEvent,
  DesktopControlSource,
  DesktopWindowAdapter,
  StopDesktopControlSubscription,
} from "./desktop-window-adapter";

// This module is the narrow frontend-to-Tauri boundary. Rendering and animation
// code therefore remain ordinary browser TypeScript and can be unit-tested without
// knowing about native windows.
const petWindow = getCurrentWindow();

const BEHAVIOR_PAUSED_EVENT = "phoebo-behavior-paused";
const WINDOW_VISIBLE_EVENT = "phoebo-window-visible";

export function reportNativeRuntimeFailure(): Promise<void> {
  // Rust can keep the tray recoverable even when frontend configuration or atlas
  // decoding fails. No diagnostic details cross IPC; the bounded browser log keeps
  // those locally while the tray tooltip gives the owner a visible failure signal.
  return invoke("report_runtime_failure");
}

export class TauriDesktopWindowAdapter implements DesktopWindowAdapter {
  show(): Promise<void> {
    return invoke("show_main_window");
  }

  hide(): Promise<void> {
    return invoke("hide_main_window");
  }

  setAlwaysOnTop(enabled: boolean): Promise<void> {
    return invoke("set_main_window_always_on_top", { enabled });
  }

  startDragging(): Promise<void> {
    // Native dragging remains a Tauri window API because it operates on the
    // calling WebView and needs no custom Rust policy or payload.
    return petWindow.startDragging();
  }

  resetToReachablePosition(): Promise<void> {
    return invoke("reset_main_window_position");
  }
}

export class TauriDesktopControlSource implements DesktopControlSource {
  readInitialBehaviorPaused(): Promise<boolean> {
    // The tray exists before the atlas finishes decoding, so query Rust after
    // subscribing instead of assuming the owner could not have clicked Pause.
    return invoke("is_behavior_paused");
  }

  async subscribe(
    listener: (event: DesktopControlEvent) => void,
  ): Promise<StopDesktopControlSubscription> {
    const unlisteners: UnlistenFn[] = [];

    try {
      unlisteners.push(
        await listen<unknown>(BEHAVIOR_PAUSED_EVENT, (event) => {
          if (typeof event.payload === "boolean") {
            listener({ kind: "behavior-paused", paused: event.payload });
          }
        }),
      );
      unlisteners.push(
        await listen<unknown>(WINDOW_VISIBLE_EVENT, (event) => {
          if (typeof event.payload === "boolean") {
            listener({ kind: "window-visible", visible: event.payload });
          }
        }),
      );
    } catch (error: unknown) {
      // If the second subscription fails, release the first one before startup
      // reports the error. This keeps retry/debug reloads from multiplying listeners.
      for (const unlisten of unlisteners) {
        unlisten();
      }
      throw error;
    }

    let stopped = false;
    return () => {
      if (stopped) {
        return;
      }
      stopped = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }
}

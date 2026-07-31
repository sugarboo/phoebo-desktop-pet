import type { AnimationFrameRenderer } from "../animation/animation-player";
import type { AtlasFrame } from "../animation/animation-profile";
import type {
  DesktopControlSource,
  DesktopWindowAdapter,
} from "../platform/desktop-window-adapter";
import petViewport from "../config/pet-viewport.json" with { type: "json" };
import {
  reportNativeRuntimeFailure,
  TauriDesktopControlSource,
  TauriDesktopWindowAdapter,
} from "../platform/tauri-desktop-window";
import { CanvasPetRenderer } from "../rendering/canvas-pet-renderer";
import { observeDevicePixelRatio } from "../rendering/device-pixel-ratio-monitor";
import { DeferredRedraw } from "./deferred-redraw";
import { subscribeToDesktopControls } from "./desktop-control-subscription";
import { disposeInReverseOrder } from "./disposer-stack";
import { loadDefaultPetAssets } from "./load-default-pet";
import { PetRuntime } from "./pet-runtime";
import { RuntimeActivityController } from "./runtime-activity-controller";

const CANVAS_SELECTOR = "#pet-canvas";

export async function bootstrapDesktopShell(): Promise<void> {
  let stopRuntime: (() => void) | undefined;

  try {
    const desktopWindow = new TauriDesktopWindowAdapter();
    const desktopControls = new TauriDesktopControlSource();
    const canvas = requirePetCanvas();
    const loadedPet = await loadDefaultPetAssets();
    // Tauri owns the native window while Canvas owns its backing store. Passing
    // the same reviewed logical viewport here keeps rendering independent from
    // the larger source cell that is cropped out of the atlas.
    const renderer = new CanvasPetRenderer(
      canvas,
      loadedPet.animationProfile.atlas,
      petViewport,
    );
    const renderFrame: AnimationFrameRenderer = (frame) => {
      renderer.renderFrame(loadedPet.atlas, frame);
    };
    const runtime = new PetRuntime(
      loadedPet.animationProfile,
      loadedPet.behaviorProfile,
      renderFrame,
      {
        onFatalError: reportRuntimeFatalError,
      },
    );

    // The native window starts hidden. Decode, validate, and paint a real frame
    // before `show()` so WebView2 never exposes an empty/white startup frame.
    renderer.renderFrame(loadedPet.atlas, loadedPet.animationProfile.atlas.neutralFrame);
    const lifecycle = await installRuntimeLifecycle(
      canvas,
      runtime,
      () => runtime.currentFrame ?? loadedPet.animationProfile.atlas.neutralFrame,
      renderFrame,
      desktopWindow,
      desktopControls,
    );
    stopRuntime = lifecycle.stop;

    // Rust clamps the window before showing it, then emits the same ordered
    // visibility event used by tray Show. Do not write a local `true` afterward:
    // a newer Hide click could otherwise be overwritten by this continuation.
    await desktopWindow.show();
    runtime.start();
    lifecycle.activity.activate();
  } catch (error: unknown) {
    stopRuntime?.();
    reportShellErrorOnce("startup", error);
    // Startup failure intentionally leaves the native tray alive. Updating its
    // tooltip makes that recoverable state visible even in a release GUI process,
    // where no console window is present.
    await reportNativeRuntimeFailure().catch(() => undefined);
  }
}

function requirePetCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>(CANVAS_SELECTOR);

  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(`Required canvas ${CANVAS_SELECTOR} was not found`);
  }

  return canvas;
}

interface InstalledRuntimeLifecycle {
  readonly activity: RuntimeActivityController;
  readonly stop: () => void;
}

async function installRuntimeLifecycle(
  canvas: HTMLCanvasElement,
  runtime: PetRuntime,
  readCurrentFrame: () => AtlasFrame,
  renderFrame: AnimationFrameRenderer,
  desktopWindow: DesktopWindowAdapter,
  desktopControls: DesktopControlSource,
): Promise<InstalledRuntimeLifecycle> {
  const deferredPixelRatioRedraw = new DeferredRedraw(() => {
    try {
      renderFrame(readCurrentFrame());
    } catch (error: unknown) {
      reportShellErrorOnce("pixel-ratio-redraw", error);
    }
  });
  const activity = new RuntimeActivityController(runtime, (runtimeAllowedToRun) => {
    deferredPixelRatioRedraw.setEnabled(runtimeAllowedToRun);
  });
  activity.setDocumentVisible(!document.hidden);
  const disposers: Array<() => void> = [];

  try {
    // Subscribe before reading the initial value so a tray click during atlas
    // decoding cannot be lost between the snapshot and listener registration.
    disposers.push(
      await subscribeToDesktopControls(desktopControls, (event) => {
        if (event.kind === "behavior-paused") {
          activity.setBehaviorPausedByUser(event.paused);
        } else {
          activity.setNativeWindowVisible(event.visible);
        }
      }),
    );
    // Moving a Tauri window between monitors can change WebView2's devicePixelRatio.
    // While active, redraw the current pose while rebuilding the backing store.
    // While paused/hidden, DeferredRedraw collapses changes into one future draw.
    disposers.push(
      observeDevicePixelRatio(() => {
        deferredPixelRatioRedraw.request();
      }),
    );
    disposers.push(installWindowDragging(canvas, desktopWindow));
    disposers.push(installVisibilityRuntime(activity));

    let stopped = false;
    const stop = (): void => {
      if (stopped) {
        return;
      }
      stopped = true;
      activity.deactivate();
      deferredPixelRatioRedraw.dispose();
      runtime.dispose();
      disposeInReverseOrder(disposers, (error) => {
        reportShellErrorOnce("lifecycle-cleanup", error);
      });
      window.removeEventListener("pagehide", stop);
    };

    // `pagehide` is the WebView lifecycle point at which browser listeners, RAFs,
    // and timeouts should be released. Every disposer is intentionally idempotent.
    window.addEventListener("pagehide", stop, { once: true });
    return Object.freeze({ activity, stop });
  } catch (error: unknown) {
    // Treat setup as a transaction. A failed media query or DOM subscription must
    // not leave the already-installed Tauri event listeners alive.
    activity.deactivate();
    deferredPixelRatioRedraw.dispose();
    runtime.dispose();
    disposeInReverseOrder(disposers, (cleanupError) => {
      reportShellErrorOnce("lifecycle-cleanup", cleanupError);
    });
    throw error;
  }
}

function installVisibilityRuntime(activity: RuntimeActivityController): () => void {
  const updateRuntime = (): void => {
    activity.setDocumentVisible(!document.hidden);
  };

  // Browser visibility remains a composition concern. Both domain state machines
  // can therefore be tested without DOM or Tauri globals.
  document.addEventListener("visibilitychange", updateRuntime);
  return () => {
    document.removeEventListener("visibilitychange", updateRuntime);
  };
}

function installWindowDragging(
  canvas: HTMLCanvasElement,
  desktopWindow: DesktopWindowAdapter,
): () => void {
  const startDragging = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    // An undecorated Tauri window has no native title bar. Forwarding a primary
    // pointer press asks the operating system to perform its normal window drag.
    void desktopWindow.startDragging().catch((error: unknown) => {
      reportShellErrorOnce("window-drag", error);
    });
  };

  canvas.addEventListener("pointerdown", startDragging);
  return () => {
    canvas.removeEventListener("pointerdown", startDragging);
  };
}

const reportedShellErrors = new Set<string>();

function reportRuntimeFatalError(error: unknown): void {
  reportShellErrorOnce("runtime", error);
  void reportNativeRuntimeFailure().catch(() => undefined);
}

function reportShellErrorOnce(operation: string, error: unknown): void {
  // Keep local failures visible during development without logging the same event
  // on every pointer action or monitor transition.
  if (reportedShellErrors.has(operation)) {
    return;
  }

  reportedShellErrors.add(operation);
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[desktop-shell:${operation}] ${message}`);
}

import type { AnimationFrameRenderer } from "../animation/animation-player";
import type { AtlasFrame } from "../animation/animation-profile";
import { startPetWindowDragging, showPetWindow } from "../platform/tauri-desktop-window";
import { CanvasPetRenderer } from "../rendering/canvas-pet-renderer";
import { observeDevicePixelRatio } from "../rendering/device-pixel-ratio-monitor";
import { loadDefaultPetAssets } from "./load-default-pet";
import { PetRuntime } from "./pet-runtime";

const CANVAS_SELECTOR = "#pet-canvas";

export async function bootstrapDesktopShell(): Promise<void> {
  let stopRuntime: (() => void) | undefined;

  try {
    const canvas = requirePetCanvas();
    const loadedPet = await loadDefaultPetAssets();
    const renderer = new CanvasPetRenderer(canvas, loadedPet.animationProfile.atlas);
    const renderFrame: AnimationFrameRenderer = (frame) => {
      renderer.renderFrame(loadedPet.atlas, frame);
    };
    const runtime = new PetRuntime(
      loadedPet.animationProfile,
      loadedPet.behaviorProfile,
      renderFrame,
    );

    // The native window starts hidden. Decode, validate, and paint a real frame
    // before `show()` so WebView2 never exposes an empty/white startup frame.
    renderer.renderFrame(loadedPet.atlas, loadedPet.animationProfile.atlas.neutralFrame);
    stopRuntime = installRuntimeLifecycle(
      canvas,
      runtime,
      () => runtime.currentFrame ?? loadedPet.animationProfile.atlas.neutralFrame,
      renderFrame,
    );
    await showPetWindow();
    runtime.start();
    if (document.hidden) {
      runtime.pause();
    }
  } catch (error: unknown) {
    stopRuntime?.();
    reportShellErrorOnce("startup", error);
  }
}

function requirePetCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>(CANVAS_SELECTOR);

  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(`Required canvas ${CANVAS_SELECTOR} was not found`);
  }

  return canvas;
}

function installRuntimeLifecycle(
  canvas: HTMLCanvasElement,
  runtime: PetRuntime,
  readCurrentFrame: () => AtlasFrame,
  renderFrame: AnimationFrameRenderer,
): () => void {
  const stopPixelRatioRedraw = installPixelRatioRedraw(readCurrentFrame, renderFrame);
  const stopDragging = installWindowDragging(canvas);
  const stopVisibilityRuntime = installVisibilityRuntime(runtime);
  let stopped = false;

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    runtime.dispose();
    stopPixelRatioRedraw();
    stopDragging();
    stopVisibilityRuntime();
    window.removeEventListener("pagehide", stop);
  };

  // `pagehide` is the WebView lifecycle point at which browser listeners, RAFs,
  // and timeouts should be released. Every disposer is intentionally idempotent.
  window.addEventListener("pagehide", stop, { once: true });
  return stop;
}

function installPixelRatioRedraw(
  readCurrentFrame: () => AtlasFrame,
  renderFrame: AnimationFrameRenderer,
): () => void {
  // Moving a Tauri window between monitors can change WebView2's devicePixelRatio.
  // Redraw the player's current pose while rebuilding the Canvas backing store;
  // resetting to neutral here would cause a visible flash during an animation.
  return observeDevicePixelRatio(() => {
    try {
      renderFrame(readCurrentFrame());
    } catch (error: unknown) {
      reportShellErrorOnce("pixel-ratio-redraw", error);
    }
  });
}

function installVisibilityRuntime(runtime: PetRuntime): () => void {
  const updateRuntime = (): void => {
    if (document.hidden) {
      runtime.pause();
    } else {
      runtime.resume();
    }
  };

  // Browser visibility remains a composition concern. Both domain state machines
  // can therefore be tested without DOM or Tauri globals.
  document.addEventListener("visibilitychange", updateRuntime);
  return () => {
    document.removeEventListener("visibilitychange", updateRuntime);
  };
}

function installWindowDragging(canvas: HTMLCanvasElement): () => void {
  const startDragging = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    // An undecorated Tauri window has no native title bar. Forwarding a primary
    // pointer press asks the operating system to perform its normal window drag.
    void startPetWindowDragging().catch((error: unknown) => {
      reportShellErrorOnce("window-drag", error);
    });
  };

  canvas.addEventListener("pointerdown", startDragging);
  return () => {
    canvas.removeEventListener("pointerdown", startDragging);
  };
}

const reportedShellErrors = new Set<string>();

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

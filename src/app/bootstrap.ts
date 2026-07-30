import { startPetWindowDragging, showPetWindow } from "../platform/tauri-desktop-window";
import { drawShellPlaceholder } from "../rendering/placeholder-renderer";

const CANVAS_SELECTOR = "#pet-canvas";

export async function bootstrapDesktopShell(): Promise<void> {
  try {
    const canvas = requirePetCanvas();

    drawShellPlaceholder(canvas);
    installWindowDragging(canvas);
    await showPetWindow();
  } catch (error: unknown) {
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

function installWindowDragging(canvas: HTMLCanvasElement): void {
  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    void startPetWindowDragging().catch((error: unknown) => {
      reportShellErrorOnce("window-drag", error);
    });
  });
}

const reportedShellErrors = new Set<string>();

function reportShellErrorOnce(operation: string, error: unknown): void {
  if (reportedShellErrors.has(operation)) {
    return;
  }

  reportedShellErrors.add(operation);
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[desktop-shell:${operation}] ${message}`);
}


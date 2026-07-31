import type { DragMotionDirection } from "./pet-runtime.js";
import type { NativeWindowPosition } from "../platform/desktop-window-adapter.js";

export interface DragMotionRuntime {
  beginDragControl(): void;
  setDragControlDirection(direction: DragMotionDirection | undefined): void;
  endDragControl(): void;
}

export interface DragMotionTimers {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface DragMotionDependencies {
  readonly readDragButtonPressed: () => Promise<boolean>;
  readonly timers?: DragMotionTimers;
  readonly onError?: (error: unknown) => void;
}

const browserTimers: DragMotionTimers = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

/**
 * Converts native window positions into a small, testable drag-animation intent.
 *
 * Tauri hands a Windows drag to the operating system, so WebView pointer-move and
 * pointer-up events are not reliable during the drag. Native physical positions
 * remain reliable, and only the sign of their X delta matters across mixed-DPI
 * displays. One timeout detects a stationary mouse; while it remains held, that
 * same timeout performs a low-frequency release check so movement can resume.
 */
export class DragMotionController {
  private readonly timers: DragMotionTimers;
  private readonly onError: ((error: unknown) => void) | undefined;
  private active = false;
  private disposed = false;
  private generation = 0;
  private timeoutHandle: number | undefined;
  private lastObservedPhysicalX: number | undefined;
  private previousDragPhysicalX: number | undefined;
  private direction: DragMotionDirection | undefined;

  constructor(
    private readonly runtime: DragMotionRuntime,
    private readonly stopDelayMs: number,
    private readonly readDragButtonPressed: () => Promise<boolean>,
    dependencies: Omit<DragMotionDependencies, "readDragButtonPressed"> = {},
  ) {
    if (!Number.isFinite(stopDelayMs) || stopDelayMs <= 0) {
      throw new RangeError("Drag stopDelayMs must be a finite number greater than zero");
    }

    this.timers = dependencies.timers ?? browserTimers;
    this.onError = dependencies.onError;
  }

  beginDrag(): void {
    this.assertUsable();
    this.cancelStateCheck();
    this.previousDragPhysicalX = this.lastObservedPhysicalX;
    this.setDirection(undefined);

    if (!this.active) {
      this.active = true;
      this.runtime.beginDragControl();
    }

    // Native pointer-up may never return to the WebView, including when the owner
    // presses without moving. Start the same bounded release check immediately.
    this.scheduleStateCheck();
  }

  observeWindowPosition(position: NativeWindowPosition): void {
    validateNativeWindowPosition(position);
    const previousPhysicalX = this.previousDragPhysicalX;
    this.lastObservedPhysicalX = position.physicalX;

    if (!this.active) {
      return;
    }

    this.previousDragPhysicalX = position.physicalX;
    if (
      previousPhysicalX === undefined ||
      position.physicalX === previousPhysicalX
    ) {
      return;
    }

    this.setDirection(position.physicalX > previousPhysicalX ? "right" : "left");
    this.scheduleStateCheck();
  }

  endDrag(): void {
    if (!this.active) {
      return;
    }

    this.cancelStateCheck();
    this.active = false;
    this.direction = undefined;
    this.previousDragPhysicalX = undefined;
    this.runtime.endDragControl();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.endDrag();
    this.disposed = true;
    this.cancelStateCheck();
  }

  private scheduleStateCheck(): void {
    this.cancelStateCheck();
    const generation = ++this.generation;
    const handle = this.timers.setTimeout(() => {
      if (this.timeoutHandle === handle) {
        this.timeoutHandle = undefined;
      }
      this.handleStationaryState(generation);
    }, this.stopDelayMs);
    this.timeoutHandle = handle;
  }

  private handleStationaryState(generation: number): void {
    if (!this.active || this.generation !== generation) {
      return;
    }

    // Returning to idle happens before the asynchronous button query, so an IPC
    // round trip cannot make the run animation visibly linger after motion stops.
    this.setDirection(undefined);

    void this.readDragButtonPressed().then(
      (pressed) => {
        if (!this.active || this.generation !== generation) {
          return;
        }

        if (pressed) {
          // The owner is holding still. Poll only at the configured stop cadence;
          // any new native move invalidates this generation and resumes locomotion.
          this.scheduleStateCheck();
        } else {
          this.endDrag();
        }
      },
      (error: unknown) => {
        if (!this.active || this.generation !== generation) {
          return;
        }

        // A failed button query must not leave random behavior suspended forever.
        this.endDrag();
        try {
          this.onError?.(error);
        } catch {
          // Diagnostics are outside interaction ownership. State is already safe.
        }
      },
    );
  }

  private setDirection(direction: DragMotionDirection | undefined): void {
    if (this.direction === direction) {
      return;
    }

    this.direction = direction;
    if (this.active) {
      this.runtime.setDragControlDirection(direction);
    }
  }

  private cancelStateCheck(): void {
    this.generation += 1;
    if (this.timeoutHandle !== undefined) {
      this.timers.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("DragMotionController has been disposed");
    }
  }
}

function validateNativeWindowPosition(position: NativeWindowPosition): void {
  if (
    !Number.isFinite(position.physicalX) ||
    !Number.isInteger(position.physicalX) ||
    !Number.isFinite(position.physicalY) ||
    !Number.isInteger(position.physicalY)
  ) {
    throw new RangeError("Native window positions must use finite integer pixels");
  }
}

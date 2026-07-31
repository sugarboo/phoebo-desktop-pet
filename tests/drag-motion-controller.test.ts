import {
  DragMotionController,
  type DragMotionRuntime,
  type DragMotionTimers,
} from "../src/app/drag-motion-controller.js";
import type { DragMotionDirection } from "../src/app/pet-runtime.js";
import {
  assertDeepEqual,
  assertEqual,
  assertThrows,
  test,
} from "./test-harness.js";

test("native X movement drives right/left loops and stationary hold returns to idle", async () => {
  const runtime = new FakeDragRuntime();
  const timers = new FakeDragTimers();
  const buttonStates = [true, false];
  const controller = new DragMotionController(
    runtime,
    140,
    async () => buttonStates.shift() ?? false,
    { timers },
  );

  controller.beginDrag();
  controller.observeWindowPosition({ physicalX: -200, physicalY: 50 });
  controller.observeWindowPosition({ physicalX: -180, physicalY: 50 });
  controller.observeWindowPosition({ physicalX: -160, physicalY: 70 });
  assertEqual(timers.maximumTimerCount, 1);

  timers.fireNext();
  await Promise.resolve();
  assertEqual(timers.timerCount, 1);

  controller.observeWindowPosition({ physicalX: -190, physicalY: 70 });
  timers.fireNext();
  await Promise.resolve();

  assertDeepEqual(runtime.events, [
    "begin",
    "right",
    "idle",
    "left",
    "idle",
    "end",
  ]);
  assertEqual(timers.timerCount, 0);
});

test("explicit release, disposal, and stale checks cannot revive drag work", async () => {
  const runtime = new FakeDragRuntime();
  const timers = new FakeDragTimers();
  let resolveButtonState: ((pressed: boolean) => void) | undefined;
  const controller = new DragMotionController(
    runtime,
    140,
    () =>
      new Promise<boolean>((resolve) => {
        resolveButtonState = resolve;
      }),
    { timers },
  );

  controller.beginDrag();
  timers.fireNext();
  controller.endDrag();
  resolveButtonState?.(true);
  await Promise.resolve();

  assertDeepEqual(runtime.events, ["begin", "end"]);
  assertEqual(timers.timerCount, 0);

  controller.dispose();
  assertThrows(() => controller.beginDrag(), "has been disposed");
});

class FakeDragRuntime implements DragMotionRuntime {
  readonly events: string[] = [];

  beginDragControl(): void {
    this.events.push("begin");
  }

  setDragControlDirection(direction: DragMotionDirection | undefined): void {
    this.events.push(direction ?? "idle");
  }

  endDragControl(): void {
    this.events.push("end");
  }
}

class FakeDragTimers implements DragMotionTimers {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();
  private highestTimerCount = 0;

  get timerCount(): number {
    return this.callbacks.size;
  }

  get maximumTimerCount(): number {
    return this.highestTimerCount;
  }

  setTimeout(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    this.highestTimerCount = Math.max(
      this.highestTimerCount,
      this.callbacks.size,
    );
    return handle;
  }

  clearTimeout(handle: number): void {
    this.callbacks.delete(handle);
  }

  fireNext(): void {
    const entry = this.callbacks.entries().next().value as
      | readonly [number, () => void]
      | undefined;
    if (entry === undefined) {
      throw new Error("Expected a drag-state timeout");
    }
    this.callbacks.delete(entry[0]);
    entry[1]();
  }
}

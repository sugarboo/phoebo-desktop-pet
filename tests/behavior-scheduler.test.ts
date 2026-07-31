import animationProfileDocument from "../src/config/animation-profiles/codex-v2.animations.json" with {
  type: "json",
};
import { parseAnimationProfile } from "../src/animation/profile-parser.js";
import type { BehaviorProfile } from "../src/behavior/behavior-profile.js";
import {
  BehaviorScheduler,
  type BehaviorActionSelection,
  type BehaviorSchedulerDependencies,
  type Clock,
  type RandomSource,
  type TimeoutScheduler,
} from "../src/behavior/behavior-scheduler.js";
import { parseBehaviorProfile } from "../src/behavior/profile-parser.js";
import {
  assert,
  assertDeepEqual,
  assertEqual,
  assertThrows,
  test,
} from "./test-harness.js";

interface ActionDocument {
  readonly clipId: string;
  readonly weight: number;
  readonly cooldownMs: number;
  readonly interruptible: boolean;
}

const animationProfile = parseAnimationProfile(animationProfileDocument as unknown);

test("selects exact weighted intervals with injected random samples", () => {
  const profile = createTestProfile([
    action("wave", 1),
    action("jump", 3),
    action("waiting", 6),
  ]);
  const timing = new FakeBehaviorTiming();
  const random = new SequenceRandomSource([0, 0.1, 0.4]);
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, random),
  );

  scheduler.start();
  for (let index = 0; index < 3; index += 1) {
    timing.fireNextTimer();
    const selection = selections[index];
    assert(selection !== undefined, `Expected selection ${index}`);
    assertEqual(scheduler.startAction(selection.selectionId), true);
    assertEqual(scheduler.completeAction(selection.selectionId), true);
  }
  scheduler.stop();

  assertDeepEqual(
    selections.map((selection) => selection.action.clipId),
    ["wave", "jump", "waiting"],
  );
  assertEqual(random.readCount, 3);
  assertEqual(timing.maximumTimerCount, 1);
});

test("samples the configured idle-delay range before selecting an action", () => {
  const profile = createTestProfile([action("wave", 1)], 100, 500);
  const timing = new FakeBehaviorTiming();
  const random = new SequenceRandomSource([0.25, 0]);
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, random),
  );

  scheduler.start();
  assertEqual(timing.nextTimerDelayMs, 200);
  assertEqual(random.readCount, 1);

  timing.advanceTo(200);
  timing.fireNextTimer();
  assertEqual(selections[0]?.action.clipId, "wave");
  assertEqual(scheduler.status, "action-pending");
  assertEqual(random.readCount, 2);
  assertEqual(timing.maximumTimerCount, 1);
});

test("a seeded random source produces a repeatable action sequence", () => {
  const profile = createTestProfile([
    action("wave", 18),
    action("jump", 12),
    action("waiting", 30),
    action("inspect", 20),
  ]);

  const firstSequence = runSeededSequence(profile, 0x5eed, 12);
  const secondSequence = runSeededSequence(profile, 0x5eed, 12);

  assertDeepEqual(firstSequence, secondSequence);
  assert(
    new Set(firstSequence).size > 1,
    "Seeded sequence should exercise more than one weighted interval",
  );
});

test("filters cooling actions and waits once until the earliest cooldown expires", () => {
  const profile = createTestProfile([
    action("wave", 1, 100),
    action("jump", 1, 200),
  ]);
  const timing = new FakeBehaviorTiming();
  const random = new SequenceRandomSource([0, 0, 0]);
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, random),
  );

  scheduler.start();
  timing.fireNextTimer();
  assertEqual(selections[0]?.action.clipId, "wave");
  assertEqual(scheduler.startAction(selections[0]!.selectionId), true);
  assertEqual(scheduler.completeAction(selections[0]!.selectionId), true);

  timing.fireNextTimer();
  assertEqual(selections[1]?.action.clipId, "jump");
  assertEqual(scheduler.startAction(selections[1]!.selectionId), true);
  assertEqual(scheduler.completeAction(selections[1]!.selectionId), true);

  // Both actions are cooling at t=0. The due callback schedules one timeout for
  // wave's t=100 eligibility boundary and consumes no random sample.
  timing.fireNextTimer();
  assertEqual(selections.length, 2);
  assertEqual(timing.timerCount, 1);
  assertEqual(timing.nextTimerDelayMs, 100);
  assertEqual(random.readCount, 2);

  timing.advanceTo(100);
  timing.fireNextTimer();
  assertEqual(selections[2]?.action.clipId, "wave");
  assertEqual(random.readCount, 3);
  assertEqual(timing.maximumTimerCount, 1);
});

test("pause and resume preserve remaining idle time and reject a captured stale timeout", () => {
  const profile = createTestProfile([action("wave", 1)], 1000, 1000);
  const timing = new FakeBehaviorTiming();
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, new SequenceRandomSource([0])),
  );

  scheduler.start();
  const staleTimeout = timing.captureNextTimer();
  timing.advanceTo(400);
  scheduler.pause();
  assertEqual(scheduler.status, "paused");
  assertEqual(timing.timerCount, 0);

  scheduler.resume();
  assertEqual(scheduler.status, "waiting");
  assertEqual(timing.timerCount, 1);
  assertEqual(timing.nextTimerDelayMs, 600);

  staleTimeout();
  assertEqual(timing.timerCount, 1);
  assertEqual(selections.length, 0);

  timing.advanceTo(1000);
  timing.fireNextTimer();
  assertEqual(selections.length, 1);
  assertEqual(scheduler.status, "action-pending");
  assertEqual(timing.maximumTimerCount, 1);
});

test("pausing an active action creates no timer and completion resumes only with its token", () => {
  const profile = createTestProfile([action("wave", 1)], 250, 250);
  const timing = new FakeBehaviorTiming();
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, new SequenceRandomSource([0])),
  );

  scheduler.start();
  timing.advanceTo(250);
  timing.fireNextTimer();
  const selection = selections[0]!;
  assertEqual(scheduler.startAction(selection.selectionId), true);

  scheduler.pause();
  assertEqual(scheduler.status, "paused");
  assertEqual(timing.timerCount, 0);
  assertEqual(scheduler.completeAction(selection.selectionId), false);

  scheduler.resume();
  assertEqual(scheduler.status, "action-active");
  assertEqual(timing.timerCount, 0);
  assertEqual(scheduler.completeAction(selection.selectionId), true);
  assertEqual(scheduler.status, "waiting");
  assertEqual(timing.timerCount, 1);
  assertEqual(timing.nextTimerDelayMs, 250);
});

test("selection tokens reject duplicate completion from an earlier repeated action", () => {
  const profile = createTestProfile([action("wave", 1)]);
  const timing = new FakeBehaviorTiming();
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, new SequenceRandomSource([0, 0])),
  );

  scheduler.start();
  timing.fireNextTimer();
  const firstSelection = selections[0]!;
  assertEqual(scheduler.startAction(firstSelection.selectionId), true);
  assertEqual(scheduler.completeAction(firstSelection.selectionId), true);

  timing.fireNextTimer();
  const secondSelection = selections[1]!;
  assert(secondSelection.selectionId !== firstSelection.selectionId, "Tokens must be unique");
  assertEqual(scheduler.startAction(firstSelection.selectionId), false);
  assertEqual(scheduler.startAction(secondSelection.selectionId), true);
  assertEqual(scheduler.startAction(secondSelection.selectionId), false);
  assertEqual(scheduler.completeAction(firstSelection.selectionId), false);
  assertEqual(scheduler.activeSelection?.selectionId, secondSelection.selectionId);
  assertEqual(scheduler.status, "action-active");
  assertEqual(timing.timerCount, 0);
});

test("avoids an immediate repeat while another action is eligible", () => {
  const profile = createTestProfile([
    action("wave", 100),
    action("jump", 1),
  ]);
  const timing = new FakeBehaviorTiming();
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, new SequenceRandomSource([0, 0, 0])),
  );

  scheduler.start();
  for (let index = 0; index < 3; index += 1) {
    timing.fireNextTimer();
    const selection = selections[index]!;
    assertEqual(scheduler.startAction(selection.selectionId), true);
    assertEqual(scheduler.completeAction(selection.selectionId), true);
  }

  assertDeepEqual(
    selections.map((selection) => selection.action.clipId),
    ["wave", "jump", "wave"],
  );
});

test("allows a repeat when every alternative is cooling down", () => {
  const profile = createTestProfile([
    action("wave", 1),
    action("jump", 1, 100),
  ]);
  const timing = new FakeBehaviorTiming();
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, new SequenceRandomSource([0.9, 0, 0])),
  );

  scheduler.start();
  for (let index = 0; index < 3; index += 1) {
    timing.fireNextTimer();
    const selection = selections[index]!;
    assertEqual(scheduler.startAction(selection.selectionId), true);
    assertEqual(scheduler.completeAction(selection.selectionId), true);
  }

  assertDeepEqual(
    selections.map((selection) => selection.action.clipId),
    ["jump", "wave", "wave"],
  );
});

test("starts cooldown when playback begins rather than when selection is queued", () => {
  const profile = createTestProfile([action("wave", 1, 100)]);
  const timing = new FakeBehaviorTiming();
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, new SequenceRandomSource([0, 0])),
  );

  scheduler.start();
  timing.fireNextTimer();
  const selection = selections[0]!;
  assertEqual(scheduler.status, "action-pending");

  timing.advanceTo(50);
  assertEqual(scheduler.startAction(selection.selectionId), true);
  assertEqual(scheduler.completeAction(selection.selectionId), true);
  timing.fireNextTimer();

  // Selection happened at t=0, but the action actually began at t=50. Its
  // 100 ms cooldown must therefore expire at t=150, not t=100.
  assertEqual(selections.length, 1);
  assertEqual(timing.nextTimerDelayMs, 100);
});

test("pause and resume preserve a pending action without creating a timer", () => {
  const profile = createTestProfile([action("wave", 1)]);
  const timing = new FakeBehaviorTiming();
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, new SequenceRandomSource([0])),
  );

  scheduler.start();
  timing.fireNextTimer();
  const selection = selections[0]!;
  scheduler.pause();

  assertEqual(scheduler.status, "paused");
  assertEqual(timing.timerCount, 0);
  assertEqual(scheduler.startAction(selection.selectionId), false);

  scheduler.resume();
  assertEqual(scheduler.status, "action-pending");
  assertEqual(timing.timerCount, 0);
  assertEqual(scheduler.startAction(selection.selectionId), true);
});

test("stop and dispose invalidate callbacks already dequeued by the browser", () => {
  const profile = createTestProfile([action("wave", 1)]);
  const timing = new FakeBehaviorTiming();
  const selections: BehaviorActionSelection[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => selections.push(selection),
    dependencies(timing, new SequenceRandomSource([0])),
  );

  scheduler.start();
  const callbackBeforeStop = timing.captureNextTimer();
  scheduler.stop();
  callbackBeforeStop();
  assertEqual(selections.length, 0);
  assertEqual(scheduler.status, "stopped");

  scheduler.start();
  const callbackBeforeDispose = timing.captureNextTimer();
  scheduler.dispose();
  callbackBeforeDispose();
  assertEqual(selections.length, 0);
  assertEqual(scheduler.status, "disposed");
  assertThrows(() => scheduler.start(), "has been disposed");
});

function action(
  clipId: string,
  weight: number,
  cooldownMs = 0,
  interruptible = true,
): ActionDocument {
  return { clipId, weight, cooldownMs, interruptible };
}

function createTestProfile(
  actions: readonly ActionDocument[],
  minimumIdleDelayMs = 0,
  maximumIdleDelayMs = 0,
): BehaviorProfile {
  return parseBehaviorProfile(
    {
      schemaVersion: 2,
      id: "test",
      defaultClipId: "idle",
      idleDelayMs: {
        minimum: minimumIdleDelayMs,
        maximum: maximumIdleDelayMs,
      },
      cadence: {
        avoidImmediateRepeat: true,
        settleBeforeActionMs: 120,
        settleAfterActionMs: 180,
      },
      actions,
    },
    animationProfile,
  );
}

function dependencies(
  timing: FakeBehaviorTiming,
  randomSource: RandomSource,
): BehaviorSchedulerDependencies {
  return {
    clock: timing,
    timers: timing,
    randomSource,
  };
}

function runSeededSequence(
  profile: BehaviorProfile,
  seed: number,
  actionCount: number,
): readonly string[] {
  const timing = new FakeBehaviorTiming();
  const clipIds: string[] = [];
  const scheduler = new BehaviorScheduler(
    profile,
    (selection) => clipIds.push(selection.action.clipId),
    dependencies(timing, new SeededRandomSource(seed)),
  );

  scheduler.start();
  for (let index = 0; index < actionCount; index += 1) {
    timing.fireNextTimer();
    const selection = scheduler.activeSelection;
    assert(selection !== undefined, `Expected seeded selection ${index}`);
    assertEqual(scheduler.startAction(selection.selectionId), true);
    assertEqual(scheduler.completeAction(selection.selectionId), true);
  }
  scheduler.stop();
  assertEqual(timing.maximumTimerCount, 1);
  return clipIds;
}

class SequenceRandomSource implements RandomSource {
  private index = 0;

  constructor(private readonly values: readonly number[]) {}

  get readCount(): number {
    return this.index;
  }

  next(): number {
    const value = this.values[this.index];
    if (value === undefined) {
      throw new Error("Test random sequence was exhausted");
    }
    this.index += 1;
    return value;
  }
}

class SeededRandomSource implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    // This small LCG is intentionally test-only. Its purpose is repeatability, not
    // cryptographic or statistical quality.
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
}

class FakeBehaviorTiming implements Clock, TimeoutScheduler {
  private nowMs = 0;
  private nextHandle = 1;
  private readonly timers = new Map<
    number,
    { readonly dueAtMs: number; readonly callback: () => void }
  >();
  private highestTimerCount = 0;

  get timerCount(): number {
    return this.timers.size;
  }

  get maximumTimerCount(): number {
    return this.highestTimerCount;
  }

  get nextTimerDelayMs(): number | undefined {
    const timer = this.findNextTimer();
    return timer === undefined ? undefined : timer.dueAtMs - this.nowMs;
  }

  now(): number {
    return this.nowMs;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, {
      dueAtMs: this.nowMs + delayMs,
      callback,
    });
    this.highestTimerCount = Math.max(this.highestTimerCount, this.timers.size);
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  advanceTo(nowMs: number): void {
    if (nowMs < this.nowMs) {
      throw new RangeError("Fake time cannot move backwards");
    }
    this.nowMs = nowMs;
  }

  fireNextTimer(): void {
    const timer = this.findNextTimer();
    if (timer === undefined) {
      throw new Error("Expected a pending behavior timeout");
    }
    if (timer.dueAtMs > this.nowMs) {
      throw new Error(
        `Behavior timeout is due at ${timer.dueAtMs}, current time is ${this.nowMs}`,
      );
    }
    this.timers.delete(timer.handle);
    timer.callback();
  }

  captureNextTimer(): () => void {
    const timer = this.findNextTimer();
    if (timer === undefined) {
      throw new Error("Expected a pending behavior timeout");
    }
    this.timers.delete(timer.handle);
    return timer.callback;
  }

  private findNextTimer():
    | {
        readonly handle: number;
        readonly dueAtMs: number;
        readonly callback: () => void;
      }
    | undefined {
    let next:
      | {
          readonly handle: number;
          readonly dueAtMs: number;
          readonly callback: () => void;
        }
      | undefined;

    for (const [handle, timer] of this.timers) {
      if (next === undefined || timer.dueAtMs < next.dueAtMs) {
        next = { handle, ...timer };
      }
    }
    return next;
  }
}

import animationProfileDocument from "../src/config/animation-profiles/codex-v2.animations.json" with {
  type: "json",
};
import behaviorProfileDocument from "../src/config/behaviors/default.behavior.json" with {
  type: "json",
};
import type { AnimationTiming } from "../src/animation/animation-player.js";
import type { AtlasFrame } from "../src/animation/animation-profile.js";
import { parseAnimationProfile } from "../src/animation/profile-parser.js";
import { PetRuntime } from "../src/app/pet-runtime.js";
import { RuntimeActivityController } from "../src/app/runtime-activity-controller.js";
import type { BehaviorProfile } from "../src/behavior/behavior-profile.js";
import type {
  Clock,
  RandomSource,
  TimeoutScheduler,
} from "../src/behavior/behavior-scheduler.js";
import { parseBehaviorProfile } from "../src/behavior/profile-parser.js";
import {
  assert,
  assertDeepEqual,
  assertEqual,
  assertThrows,
  test,
} from "./test-harness.js";

const animationProfile = parseAnimationProfile(animationProfileDocument as unknown);

test("queues at an idle boundary and applies neutral settles around the action", () => {
  const behaviorProfile = createBehaviorProfile(500);
  const environment = new FakeRuntimeEnvironment();
  const renderedFrames: Array<{ readonly atMs: number; readonly pose: string }> = [];
  const runtime = createRuntime(
    behaviorProfile,
    environment,
    new SequenceRandomSource([0]),
    (frame) => {
      renderedFrames.push({
        atMs: environment.now(),
        pose: `${frame.row}:${frame.column}`,
      });
    },
  );

  runtime.start();
  environment.runUntil(
    () => runtime.phase === "waiting-for-idle-boundary",
    100,
  );
  assertEqual(environment.now(), 500);
  assertEqual(runtime.currentFrame?.column, 2);

  environment.runUntil(
    () => runtime.phase === "settling-before-action",
    100,
  );
  assertEqual(environment.now(), 1100);
  environment.runNextEvent();
  assertDeepEqual(renderedFrames.at(-1), { atMs: 1100, pose: "0:6" });

  environment.runUntil(() => runtime.phase === "action", 100);
  assertEqual(environment.now(), 1220);
  environment.runNextEvent();
  assertDeepEqual(renderedFrames.at(-1), { atMs: 1220, pose: "3:0" });

  environment.runUntil(
    () => runtime.phase === "settling-after-action",
    100,
  );
  assertEqual(environment.now(), 1920);
  environment.runNextEvent();
  assertDeepEqual(renderedFrames.at(-1), { atMs: 1920, pose: "0:6" });

  environment.runUntil(() => runtime.phase === "idle", 100);
  assertEqual(environment.now(), 2100);
  assertEqual(environment.nextTimerDelayMs, 500);
  environment.runNextEvent();
  assertDeepEqual(renderedFrames.at(-1), { atMs: 2100, pose: "0:0" });

  assertEqual(runtime.status, "running");
  assertEqual(runtime.currentFrame?.row, 0);
  assert(environment.maximumTimerCount <= 2, "Player + scheduler may own two timers");
  assertEqual(environment.maximumAnimationFrameCount, 1);

  runtime.dispose();
  assertEqual(environment.timerCount, 0);
  assertEqual(environment.animationFrameCount, 0);
  assertThrows(() => runtime.start(), "has been disposed");
});

test("pause and resume preserve every queued and transition phase without hidden work", () => {
  const phases = [
    "waiting-for-idle-boundary",
    "settling-before-action",
    "action",
    "settling-after-action",
  ] as const;

  for (const phase of phases) {
    const environment = new FakeRuntimeEnvironment();
    const renderedFrames: AtlasFrame[] = [];
    const runtime = createRuntime(
      createBehaviorProfile(0),
      environment,
      new SequenceRandomSource([0]),
      (frame) => renderedFrames.push(frame),
    );

    runtime.start();
    environment.runUntil(() => runtime.phase === phase, 100);
    const pauseStartedAtMs = environment.now();
    const rendersBeforePause = renderedFrames.length;

    runtime.pause();
    assertEqual(runtime.status, "paused", `Expected ${phase} to pause`);
    assertEqual(environment.timerCount, 0);
    assertEqual(environment.animationFrameCount, 0);

    environment.advanceTo(pauseStartedAtMs + 60_000);
    runtime.resume();
    assertEqual(runtime.status, "running");
    environment.runUntil(() => runtime.phase === "idle", 100);
    environment.runNextEvent();

    assertEqual(runtime.currentFrame?.row, 0);
    assert(
      renderedFrames.length > rendersBeforePause,
      `Expected ${phase} to continue rendering after resume`,
    );
    assert(environment.maximumTimerCount <= 2, "Resume must not multiply timers");
    assertEqual(environment.maximumAnimationFrameCount, 1);

    runtime.dispose();
    assertEqual(environment.timerCount, 0);
    assertEqual(environment.animationFrameCount, 0);
  }
});

test("zero settle durations take the direct action path without a neutral pose", () => {
  const environment = new FakeRuntimeEnvironment();
  const renderedFrames: AtlasFrame[] = [];
  const runtime = createRuntime(
    createBehaviorProfile(0, 0, 0),
    environment,
    new SequenceRandomSource([0]),
    (frame) => renderedFrames.push(frame),
  );

  runtime.start();
  environment.runUntil(() => runtime.phase === "action", 100);
  environment.runUntil(() => runtime.phase === "idle", 100);
  environment.runNextEvent();

  assert(
    !renderedFrames.some((frame) => frame.row === 0 && frame.column === 6),
    "Zero-duration settles must not render the neutral atlas pose",
  );
  assert(renderedFrames.some((frame) => frame.row === 3), "Expected wave frames");
  assertEqual(runtime.currentFrame?.row, 0);
  runtime.dispose();
});

test("captured settle callbacks cannot revive work after disposal", () => {
  const timerEnvironment = new FakeRuntimeEnvironment();
  const timerFrames: AtlasFrame[] = [];
  const timerRuntime = createRuntime(
    createBehaviorProfile(0),
    timerEnvironment,
    new SequenceRandomSource([0]),
    (frame) => timerFrames.push(frame),
  );

  timerRuntime.start();
  timerEnvironment.runUntil(
    () => timerRuntime.phase === "settling-before-action",
    100,
  );
  timerEnvironment.runNextEvent(); // Draw neutral and arm its completion timeout.
  const staleSettleTimer = timerEnvironment.captureNextTimer();
  timerRuntime.dispose();
  staleSettleTimer();

  assertEqual(timerRuntime.status, "disposed");
  assert(
    !timerFrames.some((frame) => frame.row === 3),
    "A stale pre-settle timer must not start the queued action",
  );
  assertEqual(timerEnvironment.timerCount, 0);
  assertEqual(timerEnvironment.animationFrameCount, 0);

  const frameEnvironment = new FakeRuntimeEnvironment();
  const frameFrames: AtlasFrame[] = [];
  const frameRuntime = createRuntime(
    createBehaviorProfile(0),
    frameEnvironment,
    new SequenceRandomSource([0]),
    (frame) => frameFrames.push(frame),
  );

  frameRuntime.start();
  frameEnvironment.runUntil(
    () => frameRuntime.phase === "settling-after-action",
    100,
  );
  const staleSettleFrame = frameEnvironment.captureNextAnimationFrame();
  const renderCountBeforeDispose = frameFrames.length;
  frameRuntime.dispose();
  staleSettleFrame();

  assertEqual(frameRuntime.status, "disposed");
  assertEqual(frameFrames.length, renderCountBeforeDispose);
  assertEqual(frameEnvironment.timerCount, 0);
  assertEqual(frameEnvironment.animationFrameCount, 0);
});

test("native hide and owner pause keep the real runtime free of scheduled work", () => {
  const environment = new FakeRuntimeEnvironment();
  const runtime = createRuntime(
    createBehaviorProfile(500),
    environment,
    new SequenceRandomSource([0]),
    () => undefined,
  );
  const activity = new RuntimeActivityController(runtime);

  runtime.start();
  activity.setNativeWindowVisible(true);
  activity.activate();
  activity.setNativeWindowVisible(false);

  assertEqual(runtime.status, "paused");
  assertEqual(environment.timerCount, 0);
  assertEqual(environment.animationFrameCount, 0);

  activity.setBehaviorPausedByUser(true);
  activity.setNativeWindowVisible(true);
  assertEqual(runtime.status, "paused");
  assertEqual(environment.timerCount, 0);
  assertEqual(environment.animationFrameCount, 0);

  activity.setBehaviorPausedByUser(false);
  assertEqual(runtime.status, "running");
  assert(
    environment.timerCount > 0 || environment.animationFrameCount > 0,
    "Resuming should restore bounded player or scheduler work",
  );

  activity.deactivate();
  runtime.dispose();
  assertEqual(environment.timerCount, 0);
  assertEqual(environment.animationFrameCount, 0);
});

test("runs thirty virtual minutes without a stuck action or multiplied callbacks", () => {
  const behaviorProfile = parseBehaviorProfile(
    behaviorProfileDocument as unknown,
    animationProfile,
  );
  const environment = new FakeRuntimeEnvironment();
  const observer = new SoakObserver();
  const runtime = createRuntime(
    behaviorProfile,
    environment,
    new SeededRandomSource(0x5eed),
    (frame) => observer.observe(frame),
  );

  runtime.start();
  environment.runUntilTime(30 * 60 * 1000, 100_000);
  environment.runUntil(
    () =>
      runtime.phase === "idle" &&
      observer.actionStarts === observer.actionCompletions,
    100,
  );

  assertEqual(runtime.status, "running");
  assert(observer.renderCount > 1_000, "Soak should exercise many frame boundaries");
  // A 60–120 second cadence intentionally produces far fewer actions than the
  // earlier rapid profile, but a thirty-minute virtual soak still covers many
  // complete idle -> action -> idle transitions.
  assert(observer.actionStarts > 10, "Soak should exercise repeated random actions");
  assert(observer.actionStarts < 30, "No action may start more often than once per minute");
  assertEqual(observer.actionCompletions, observer.actionStarts);
  assert(environment.maximumTimerCount <= 2, "Timers must remain bounded at two");
  assertEqual(environment.maximumAnimationFrameCount, 1);
  assert(environment.maximumScheduledWorkCount <= 3, "Timers and RAF must stay bounded");

  runtime.dispose();
  assertEqual(environment.timerCount, 0);
  assertEqual(environment.animationFrameCount, 0);
});

test("runtime rendering failure disposes all work before reporting once", () => {
  const environment = new FakeRuntimeEnvironment();
  const fatalErrors: unknown[] = [];
  const renderError = new Error("Canvas draw failed");
  const runtime = createRuntime(
    createBehaviorProfile(500),
    environment,
    new SequenceRandomSource([0]),
    () => {
      throw renderError;
    },
    (error) => fatalErrors.push(error),
  );

  runtime.start();
  const staleBehaviorTimeout = environment.captureNextTimer();
  environment.runNextEvent();
  staleBehaviorTimeout();

  assertEqual(runtime.status, "failed");
  assertEqual(environment.timerCount, 0);
  assertEqual(environment.animationFrameCount, 0);
  assertDeepEqual(fatalErrors, [renderError]);
  assertThrows(() => runtime.start(), "PetRuntime is failed");
});

function createBehaviorProfile(
  idleDelayMs: number,
  settleBeforeActionMs = 120,
  settleAfterActionMs = 180,
): BehaviorProfile {
  return parseBehaviorProfile(
    {
      schemaVersion: 2,
      id: "runtime-test",
      defaultClipId: "idle",
      idleDelayMs: {
        minimum: idleDelayMs,
        maximum: idleDelayMs,
      },
      cadence: {
        avoidImmediateRepeat: true,
        settleBeforeActionMs,
        settleAfterActionMs,
      },
      actions: [
        {
          clipId: "wave",
          weight: 1,
          cooldownMs: 0,
          interruptible: false,
        },
      ],
    },
    animationProfile,
  );
}

function createRuntime(
  behaviorProfile: BehaviorProfile,
  environment: FakeRuntimeEnvironment,
  randomSource: RandomSource,
  renderFrame: (frame: AtlasFrame) => void,
  onFatalError?: (error: unknown) => void,
): PetRuntime {
  return new PetRuntime(animationProfile, behaviorProfile, renderFrame, {
    animationTiming: environment,
    behaviorScheduling: {
      clock: environment,
      randomSource,
      timers: environment,
    },
    onFatalError,
  });
}

class SoakObserver {
  renderCount = 0;
  actionStarts = 0;
  actionCompletions = 0;
  private lastKind: "idle" | "action" | undefined;

  observe(frame: AtlasFrame): void {
    const kind = frame.row === 0 ? "idle" : "action";
    this.renderCount += 1;
    if (kind === "action" && this.lastKind === "idle") {
      this.actionStarts += 1;
    } else if (kind === "idle" && this.lastKind === "action") {
      this.actionCompletions += 1;
    }
    this.lastKind = kind;
  }
}

class SequenceRandomSource implements RandomSource {
  private index = 0;

  constructor(private readonly values: readonly number[]) {}

  next(): number {
    const value = this.values[this.index];
    if (value === undefined) {
      throw new Error("Runtime test random sequence was exhausted");
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
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
}

class FakeRuntimeEnvironment implements AnimationTiming, Clock, TimeoutScheduler {
  private nowMs = 0;
  private nextHandle = 1;
  private readonly timers = new Map<
    number,
    { readonly dueAtMs: number; readonly callback: () => void }
  >();
  private readonly animationFrames = new Map<number, () => void>();
  private highestTimerCount = 0;
  private highestAnimationFrameCount = 0;
  private highestScheduledWorkCount = 0;

  get timerCount(): number {
    return this.timers.size;
  }

  get animationFrameCount(): number {
    return this.animationFrames.size;
  }

  get maximumTimerCount(): number {
    return this.highestTimerCount;
  }

  get maximumAnimationFrameCount(): number {
    return this.highestAnimationFrameCount;
  }

  get maximumScheduledWorkCount(): number {
    return this.highestScheduledWorkCount;
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
    this.recordScheduledWork();
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  requestAnimationFrame(callback: () => void): number {
    const handle = this.nextHandle++;
    this.animationFrames.set(handle, callback);
    this.recordScheduledWork();
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.animationFrames.delete(handle);
  }

  advanceTo(nowMs: number): void {
    if (nowMs < this.nowMs) {
      throw new RangeError("Fake runtime time cannot move backwards");
    }
    this.nowMs = nowMs;
  }

  runNextEvent(): void {
    const animationFrame = this.animationFrames.entries().next().value as
      | readonly [number, () => void]
      | undefined;
    if (animationFrame !== undefined) {
      this.animationFrames.delete(animationFrame[0]);
      animationFrame[1]();
      return;
    }

    const timer = this.findNextTimer();
    if (timer === undefined) {
      throw new Error("Expected scheduled runtime work");
    }
    this.advanceTo(timer.dueAtMs);
    this.timers.delete(timer.handle);
    timer.callback();
  }

  runUntil(predicate: () => boolean, maximumSteps: number): void {
    for (let step = 0; step < maximumSteps; step += 1) {
      if (predicate()) {
        return;
      }
      this.runNextEvent();
    }
    throw new Error(`Runtime condition was not reached in ${maximumSteps} events`);
  }

  runUntilTime(targetTimeMs: number, maximumSteps: number): void {
    for (let step = 0; step < maximumSteps; step += 1) {
      if (this.nowMs >= targetTimeMs) {
        return;
      }

      if (this.animationFrames.size > 0) {
        this.runNextEvent();
        continue;
      }

      const timer = this.findNextTimer();
      if (timer === undefined || timer.dueAtMs > targetTimeMs) {
        this.advanceTo(targetTimeMs);
        return;
      }
      this.runNextEvent();
    }
    throw new Error(`Virtual soak exceeded ${maximumSteps} events`);
  }

  captureNextTimer(): () => void {
    const timer = this.findNextTimer();
    if (timer === undefined) {
      throw new Error("Expected a pending runtime timeout");
    }
    this.timers.delete(timer.handle);
    return timer.callback;
  }

  captureNextAnimationFrame(): () => void {
    const entry = this.animationFrames.entries().next().value as
      | readonly [number, () => void]
      | undefined;
    if (entry === undefined) {
      throw new Error("Expected a pending runtime requestAnimationFrame");
    }
    this.animationFrames.delete(entry[0]);
    return entry[1];
  }

  private recordScheduledWork(): void {
    this.highestTimerCount = Math.max(this.highestTimerCount, this.timers.size);
    this.highestAnimationFrameCount = Math.max(
      this.highestAnimationFrameCount,
      this.animationFrames.size,
    );
    this.highestScheduledWorkCount = Math.max(
      this.highestScheduledWorkCount,
      this.timers.size + this.animationFrames.size,
    );
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

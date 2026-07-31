import type {
  AnimationClip,
  AtlasFrame,
} from "../src/animation/animation-profile.js";
import {
  AnimationPlayer,
  type AnimationTiming,
} from "../src/animation/animation-player.js";
import {
  assertDeepEqual,
  assertEqual,
  test,
} from "./test-harness.js";

const LOOP_CLIP: AnimationClip = {
  id: "test-loop",
  playback: "loop",
  frames: [
    { row: 0, column: 0, durationMs: 100 },
    { row: 0, column: 1, durationMs: 50 },
    { row: 0, column: 2, durationMs: 150 },
  ],
};

const ONCE_CLIP: AnimationClip = {
  id: "test-once",
  playback: "once",
  frames: [
    { row: 1, column: 0, durationMs: 80 },
    { row: 1, column: 1, durationMs: 120 },
  ],
};

const POSE_CLIP: AnimationClip = {
  id: "test-pose",
  playback: "pose",
  frames: [{ row: 9, column: 3, durationMs: 1 }],
};

test("renders loop frames at elapsed-time boundaries without a continuous RAF", () => {
  const timing = new FakeAnimationTiming();
  const renderedFrames: AtlasFrame[] = [];
  const player = new AnimationPlayer((frame) => renderedFrames.push(frame), timing);

  player.playClip(LOOP_CLIP);
  assertScheduling(timing, 0, 1);

  timing.flushAnimationFrame();
  assertDeepEqual(renderedFrames, [{ row: 0, column: 0, durationMs: 100 }]);
  assertScheduling(timing, 1, 0);
  assertEqual(timing.nextTimerDelayMs, 100);

  timing.advanceTo(100);
  timing.fireNextTimer();
  assertScheduling(timing, 0, 1);
  timing.flushAnimationFrame();
  assertDeepEqual(renderedFrames.at(-1), { row: 0, column: 1, durationMs: 50 });
  assertEqual(timing.nextTimerDelayMs, 50);

  // Simulate a late WebView timer: frame selection uses total elapsed time rather
  // than blindly advancing one frame per callback.
  timing.advanceTo(170);
  timing.fireNextTimer();
  timing.flushAnimationFrame();
  assertDeepEqual(renderedFrames.at(-1), { row: 0, column: 2, durationMs: 150 });
  assertEqual(timing.nextTimerDelayMs, 130);

  timing.advanceTo(300);
  timing.fireNextTimer();
  timing.flushAnimationFrame();
  assertDeepEqual(renderedFrames.at(-1), { row: 0, column: 0, durationMs: 100 });
  assertScheduling(timing, 1, 0);
});

test("completes a one-shot exactly once after its configured duration", () => {
  const timing = new FakeAnimationTiming();
  const renderedFrames: AtlasFrame[] = [];
  const completions: string[] = [];
  const player = new AnimationPlayer((frame) => renderedFrames.push(frame), timing);

  player.playClip(ONCE_CLIP, {
    onComplete: (clipId) => completions.push(clipId),
  });
  timing.flushAnimationFrame();
  timing.advanceTo(80);
  timing.fireNextTimer();
  timing.flushAnimationFrame();
  timing.advanceTo(200);
  timing.fireNextTimer();
  timing.flushAnimationFrame();

  assertDeepEqual(
    renderedFrames,
    [
      { row: 1, column: 0, durationMs: 80 },
      { row: 1, column: 1, durationMs: 120 },
    ],
  );
  assertDeepEqual(completions, ["test-once"]);
  assertEqual(player.status, "stopped");
  assertScheduling(timing, 0, 0);
});

test("holds a pose without creating a frame-boundary timeout", () => {
  const timing = new FakeAnimationTiming();
  const renderedFrames: AtlasFrame[] = [];
  const player = new AnimationPlayer((frame) => renderedFrames.push(frame), timing);

  player.playClip(POSE_CLIP);
  assertEqual(player.status, "pose");
  assertScheduling(timing, 0, 1);
  timing.flushAnimationFrame();

  assertDeepEqual(renderedFrames, [{ row: 9, column: 3, durationMs: 1 }]);
  assertDeepEqual(player.currentFrame, { row: 9, column: 3, durationMs: 1 });
  assertScheduling(timing, 0, 0);
});

test("pause cancels a pending pose RAF and resume redraws it exactly once", () => {
  const timing = new FakeAnimationTiming();
  const renderedFrames: AtlasFrame[] = [];
  const player = new AnimationPlayer((frame) => renderedFrames.push(frame), timing);

  player.playClip(POSE_CLIP);
  const stalePoseFrame = timing.captureNextAnimationFrame();
  player.pause();
  assertEqual(player.status, "paused");
  assertScheduling(timing, 0, 0);

  player.resume();
  assertEqual(player.status, "pose");
  assertScheduling(timing, 0, 1);

  stalePoseFrame();
  assertDeepEqual(renderedFrames, []);
  assertScheduling(timing, 0, 1);

  timing.flushAnimationFrame();
  assertDeepEqual(renderedFrames, [{ row: 9, column: 3, durationMs: 1 }]);
  assertScheduling(timing, 0, 0);
});

test("cancellation prevents captured stale timer and RAF callbacks from rendering", () => {
  const timing = new FakeAnimationTiming();
  const renderedFrames: AtlasFrame[] = [];
  const completions: string[] = [];
  const player = new AnimationPlayer((frame) => renderedFrames.push(frame), timing);

  player.playClip(LOOP_CLIP);
  const staleInitialRender = timing.captureNextAnimationFrame();
  player.cancel();
  staleInitialRender();

  player.playClip(ONCE_CLIP, {
    onComplete: (clipId) => completions.push(clipId),
  });
  timing.flushAnimationFrame();
  const staleTimer = timing.captureNextTimer();
  player.cancel();
  staleTimer();

  assertDeepEqual(renderedFrames, [{ row: 1, column: 0, durationMs: 80 }]);
  assertDeepEqual(completions, []);
  assertEqual(player.status, "stopped");
  assertScheduling(timing, 0, 0);
});

test("pause and resume preserve the remaining frame time without hidden wake-ups", () => {
  const timing = new FakeAnimationTiming();
  const renderedFrames: AtlasFrame[] = [];
  const player = new AnimationPlayer((frame) => renderedFrames.push(frame), timing);

  player.playClip(LOOP_CLIP);
  timing.flushAnimationFrame();
  timing.advanceTo(40);
  player.pause();
  assertEqual(player.status, "paused");
  assertScheduling(timing, 0, 0);

  timing.advanceTo(10_000);
  player.resume();
  timing.flushAnimationFrame();
  assertEqual(player.status, "playing");
  assertEqual(renderedFrames.length, 1);
  assertEqual(timing.nextTimerDelayMs, 60);

  timing.advanceTo(10_060);
  timing.fireNextTimer();
  timing.flushAnimationFrame();
  assertDeepEqual(renderedFrames.at(-1), { row: 0, column: 1, durationMs: 50 });
});

test("callbacks captured before pause cannot disturb the resumed schedule", () => {
  const timerTiming = new FakeAnimationTiming();
  const timerPlayer = new AnimationPlayer(() => {}, timerTiming);

  timerPlayer.playClip(LOOP_CLIP);
  timerTiming.flushAnimationFrame();
  const staleTimer = timerTiming.captureNextTimer();
  timerPlayer.pause();
  timerPlayer.resume();
  timerTiming.flushAnimationFrame();
  assertScheduling(timerTiming, 1, 0);

  staleTimer();
  assertScheduling(timerTiming, 1, 0);

  const frameTiming = new FakeAnimationTiming();
  const renderedFrames: AtlasFrame[] = [];
  const framePlayer = new AnimationPlayer(
    (frame) => renderedFrames.push(frame),
    frameTiming,
  );

  framePlayer.playClip(LOOP_CLIP);
  const staleAnimationFrame = frameTiming.captureNextAnimationFrame();
  framePlayer.pause();
  framePlayer.resume();
  assertScheduling(frameTiming, 0, 1);

  staleAnimationFrame();
  assertScheduling(frameTiming, 0, 1);
  frameTiming.flushAnimationFrame();
  assertEqual(renderedFrames.length, 1);
  assertScheduling(frameTiming, 1, 0);
});

test("large sleep jumps restart loops and finish one-shots with bounded work", () => {
  const loopTiming = new FakeAnimationTiming();
  const loopFrames: AtlasFrame[] = [];
  const loopPlayer = new AnimationPlayer(
    (frame) => loopFrames.push(frame),
    loopTiming,
    { maximumCatchUpMs: 1_000 },
  );

  loopPlayer.playClip(LOOP_CLIP);
  loopTiming.flushAnimationFrame();
  loopTiming.advanceTo(60_000);
  loopTiming.fireNextTimer();
  loopTiming.flushAnimationFrame();

  assertEqual(loopPlayer.status, "playing");
  assertEqual(loopFrames.length, 1);
  assertEqual(loopTiming.nextTimerDelayMs, 100);
  assertScheduling(loopTiming, 1, 0);

  const onceTiming = new FakeAnimationTiming();
  const onceCompletions: string[] = [];
  const oncePlayer = new AnimationPlayer(
    () => {},
    onceTiming,
    { maximumCatchUpMs: 1_000 },
  );

  oncePlayer.playClip(ONCE_CLIP, {
    onComplete: (clipId) => onceCompletions.push(clipId),
  });
  onceTiming.flushAnimationFrame();
  onceTiming.advanceTo(60_000);
  onceTiming.fireNextTimer();
  onceTiming.flushAnimationFrame();

  assertDeepEqual(onceCompletions, ["test-once"]);
  assertEqual(oncePlayer.status, "stopped");
  assertScheduling(onceTiming, 0, 0);
});

test("a completion listener can safely start the next clip", () => {
  const timing = new FakeAnimationTiming();
  const renderedFrames: AtlasFrame[] = [];
  const player = new AnimationPlayer((frame) => renderedFrames.push(frame), timing);

  player.playClip(ONCE_CLIP, {
    onComplete: () => player.playClip(LOOP_CLIP),
  });
  timing.flushAnimationFrame();
  timing.advanceTo(200);
  timing.fireNextTimer();
  timing.flushAnimationFrame();
  timing.flushAnimationFrame();

  assertEqual(player.status, "playing");
  assertDeepEqual(renderedFrames.at(-1), { row: 0, column: 0, durationMs: 100 });
  assertScheduling(timing, 1, 0);
});

test("does not report a loop boundary for the initial loop frame", () => {
  const timing = new FakeAnimationTiming();
  const boundaries: string[] = [];
  const player = new AnimationPlayer(() => {}, timing);

  player.playClip(LOOP_CLIP, {
    onLoopBoundary: (clipId) => boundaries.push(clipId),
  });
  timing.flushAnimationFrame();

  assertDeepEqual(boundaries, []);
  assertScheduling(timing, 1, 0);
});

test("reports an exact loop boundary once before the next cycle frame", () => {
  const timing = new FakeAnimationTiming();
  const renderedFrames: AtlasFrame[] = [];
  const boundaries: string[] = [];
  const player = new AnimationPlayer((frame) => renderedFrames.push(frame), timing);

  player.playClip(LOOP_CLIP, {
    onLoopBoundary: (clipId) => boundaries.push(clipId),
  });
  timing.flushAnimationFrame();

  // The pending frame-boundary timeout wakes late at the exact 300 ms clip
  // boundary. The callback is emitted before the next loop's first frame.
  timing.advanceTo(300);
  timing.fireNextTimer();
  timing.flushAnimationFrame();

  assertDeepEqual(boundaries, ["test-loop"]);
  assertDeepEqual(renderedFrames, [{ row: 0, column: 0, durationMs: 100 }]);
  assertScheduling(timing, 1, 0);
  assertEqual(timing.nextTimerDelayMs, 100);
});

test("reports at most one boundary when a late wake-up crosses several loops", () => {
  const timing = new FakeAnimationTiming();
  const boundaries: string[] = [];
  const player = new AnimationPlayer(() => {}, timing);

  player.playClip(LOOP_CLIP, {
    onLoopBoundary: (clipId) => boundaries.push(clipId),
  });
  timing.flushAnimationFrame();

  // 950 ms is three complete 300 ms loops plus 50 ms. Missed history is not
  // replayed because runtime only needs one safe point at which to switch clips.
  timing.advanceTo(950);
  timing.fireNextTimer();
  timing.flushAnimationFrame();

  assertDeepEqual(boundaries, ["test-loop"]);
  assertScheduling(timing, 1, 0);
  assertEqual(timing.nextTimerDelayMs, 50);
});

test("long-sleep pause resets loop boundary counting before resume", () => {
  const timing = new FakeAnimationTiming();
  const boundaries: string[] = [];
  const player = new AnimationPlayer(
    () => {},
    timing,
    { maximumCatchUpMs: 1_000 },
  );

  player.playClip(LOOP_CLIP, {
    onLoopBoundary: (clipId) => boundaries.push(clipId),
  });
  timing.flushAnimationFrame();

  // Establish a pre-sleep count of three loops without crossing the 1 s catch-up
  // limit in a single observation gap.
  timing.advanceTo(900);
  timing.fireNextTimer();
  timing.flushAnimationFrame();
  assertDeepEqual(boundaries, ["test-loop"]);
  boundaries.length = 0;

  timing.advanceTo(3_000);
  player.pause();
  player.resume();
  timing.flushAnimationFrame();

  // Resume restarts elapsed time at zero. The next complete 300 ms loop must emit
  // a boundary immediately; it must not wait to rebuild the old count of three.
  timing.advanceTo(3_100);
  timing.fireNextTimer();
  timing.flushAnimationFrame();
  timing.advanceTo(3_150);
  timing.fireNextTimer();
  timing.flushAnimationFrame();
  timing.advanceTo(3_300);
  timing.fireNextTimer();
  timing.flushAnimationFrame();

  assertDeepEqual(boundaries, ["test-loop"]);
  assertScheduling(timing, 1, 0);
});

test("a loop-boundary listener can replace the clip without stale work", () => {
  const timing = new FakeAnimationTiming();
  const renderedFrames: AtlasFrame[] = [];
  const boundaries: string[] = [];
  const player = new AnimationPlayer((frame) => renderedFrames.push(frame), timing);

  player.playClip(LOOP_CLIP, {
    onLoopBoundary: (clipId) => {
      boundaries.push(clipId);
      player.playClip(ONCE_CLIP);
    },
  });
  timing.flushAnimationFrame();

  timing.advanceTo(300);
  timing.fireNextTimer();
  timing.flushAnimationFrame();

  // Replacing the clip queues only the new clip's initial RAF. The old loop
  // must return immediately instead of drawing or arming its next timeout.
  assertDeepEqual(boundaries, ["test-loop"]);
  assertDeepEqual(renderedFrames, [{ row: 0, column: 0, durationMs: 100 }]);
  assertScheduling(timing, 0, 1);

  timing.flushAnimationFrame();
  assertDeepEqual(renderedFrames.at(-1), { row: 1, column: 0, durationMs: 80 });
  assertScheduling(timing, 1, 0);
  assertEqual(timing.nextTimerDelayMs, 80);
});

test("renderer failure stops all playback work and reports once", () => {
  const timing = new FakeAnimationTiming();
  const fatalErrors: unknown[] = [];
  const renderError = new Error("renderer failed");
  const player = new AnimationPlayer(
    () => {
      throw renderError;
    },
    timing,
    {
      onFatalError: (error) => fatalErrors.push(error),
    },
  );

  player.playClip(LOOP_CLIP);
  const failingRender = timing.captureNextAnimationFrame();
  failingRender();
  failingRender();

  assertEqual(player.status, "stopped");
  assertScheduling(timing, 0, 0);
  assertDeepEqual(fatalErrors, [renderError]);
});

test("throwing playback callbacks fail closed without scheduled work", () => {
  const boundaryTiming = new FakeAnimationTiming();
  const boundaryErrors: unknown[] = [];
  const boundaryError = new Error("boundary failed");
  const boundaryPlayer = new AnimationPlayer(
    () => undefined,
    boundaryTiming,
    { onFatalError: (error) => boundaryErrors.push(error) },
  );

  boundaryPlayer.playClip(LOOP_CLIP, {
    onLoopBoundary: () => {
      throw boundaryError;
    },
  });
  boundaryTiming.flushAnimationFrame();
  boundaryTiming.advanceTo(300);
  boundaryTiming.fireNextTimer();
  boundaryTiming.flushAnimationFrame();

  assertEqual(boundaryPlayer.status, "stopped");
  assertScheduling(boundaryTiming, 0, 0);
  assertDeepEqual(boundaryErrors, [boundaryError]);

  const completionTiming = new FakeAnimationTiming();
  const completionErrors: unknown[] = [];
  const completionError = new Error("completion failed");
  const completionPlayer = new AnimationPlayer(
    () => undefined,
    completionTiming,
    { onFatalError: (error) => completionErrors.push(error) },
  );

  completionPlayer.playClip(ONCE_CLIP, {
    onComplete: () => {
      throw completionError;
    },
  });
  completionTiming.flushAnimationFrame();
  completionTiming.advanceTo(200);
  completionTiming.fireNextTimer();
  completionTiming.flushAnimationFrame();

  assertEqual(completionPlayer.status, "stopped");
  assertScheduling(completionTiming, 0, 0);
  assertDeepEqual(completionErrors, [completionError]);
});

function assertScheduling(
  timing: FakeAnimationTiming,
  expectedTimers: number,
  expectedAnimationFrames: number,
): void {
  assertEqual(timing.timerCount, expectedTimers, "Unexpected timeout count");
  assertEqual(
    timing.animationFrameCount,
    expectedAnimationFrames,
    "Unexpected requestAnimationFrame count",
  );
}

class FakeAnimationTiming implements AnimationTiming {
  private nowMs = 0;
  private nextHandle = 1;
  private readonly timers = new Map<
    number,
    { readonly dueAtMs: number; readonly callback: () => void }
  >();
  private readonly animationFrames = new Map<number, () => void>();

  get timerCount(): number {
    return this.timers.size;
  }

  get animationFrameCount(): number {
    return this.animationFrames.size;
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
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  requestAnimationFrame(callback: () => void): number {
    const handle = this.nextHandle++;
    this.animationFrames.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.animationFrames.delete(handle);
  }

  advanceTo(nowMs: number): void {
    if (nowMs < this.nowMs) {
      throw new RangeError("Fake time cannot move backwards");
    }
    this.nowMs = nowMs;
  }

  fireNextTimer(): void {
    this.captureNextTimer()();
  }

  flushAnimationFrame(): void {
    this.captureNextAnimationFrame()();
  }

  captureNextTimer(): () => void {
    const timer = this.findNextTimer();
    if (timer === undefined) {
      throw new Error("Expected a pending timeout");
    }
    this.timers.delete(timer.handle);
    return timer.callback;
  }

  captureNextAnimationFrame(): () => void {
    const entry = this.animationFrames.entries().next().value as
      | readonly [number, () => void]
      | undefined;
    if (entry === undefined) {
      throw new Error("Expected a pending requestAnimationFrame");
    }
    this.animationFrames.delete(entry[0]);
    return entry[1];
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

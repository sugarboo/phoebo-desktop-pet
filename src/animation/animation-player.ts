import type {
  AnimationClip,
  AtlasFrame,
} from "./animation-profile.js";

export interface AnimationTiming {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
}

export type AnimationPlayerStatus =
  | "stopped"
  | "playing"
  | "paused"
  | "pose"
  | "disposed";

export type AnimationCompletionListener = (clipId: string) => void;
export type AnimationLoopBoundaryListener = (clipId: string) => void;
export type AnimationFrameRenderer = (frame: AtlasFrame) => void;

export interface AnimationPlaybackCallbacks {
  readonly onComplete?: AnimationCompletionListener;
  readonly onLoopBoundary?: AnimationLoopBoundaryListener;
}

export interface AnimationPlayerOptions {
  readonly maximumCatchUpMs?: number;
  readonly onFatalError?: (error: unknown) => void;
}

interface ActivePlayback {
  generation: number;
  readonly clip: AnimationClip;
  readonly durationMs: number;
  readonly callbacks: AnimationPlaybackCallbacks;
  startedAtMs: number;
  lastObservedAtMs: number;
  pausedElapsedMs: number;
  renderedFrameIndex: number | undefined;
  completedLoopCount: number;
}

interface FrameLocation {
  readonly frameIndex: number;
  readonly millisecondsUntilNextFrame: number;
}

const DEFAULT_MAXIMUM_CATCH_UP_MS = 60_000;

const browserAnimationTiming: AnimationTiming = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(() => callback()),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
};

/**
 * Advances sprite clips with one low-frequency timeout and one render callback.
 *
 * The timeout only wakes the WebView near a configured frame boundary. The
 * requestAnimationFrame callback then recalculates the frame from monotonic elapsed
 * time, so a late browser timer cannot make the animation permanently drift.
 */
export class AnimationPlayer {
  private readonly maximumCatchUpMs: number;
  private readonly onFatalError: ((error: unknown) => void) | undefined;

  private playerStatus: AnimationPlayerStatus = "stopped";
  private fatalErrorReported = false;
  private generation = 0;
  private activePlayback: ActivePlayback | undefined;
  private displayedFrame: AtlasFrame | undefined;
  private timeoutHandle: number | undefined;
  private animationFrameHandle: number | undefined;

  constructor(
    private readonly renderFrame: AnimationFrameRenderer,
    private readonly timing: AnimationTiming = browserAnimationTiming,
    options: AnimationPlayerOptions = {},
  ) {
    const maximumCatchUpMs = options.maximumCatchUpMs ?? DEFAULT_MAXIMUM_CATCH_UP_MS;
    if (!Number.isFinite(maximumCatchUpMs) || maximumCatchUpMs <= 0) {
      throw new RangeError("maximumCatchUpMs must be a finite number greater than zero");
    }
    this.maximumCatchUpMs = maximumCatchUpMs;
    this.onFatalError = options.onFatalError;
  }

  get status(): AnimationPlayerStatus {
    return this.playerStatus;
  }

  /**
   * The last requested pose remains available while stopped or paused. DPR changes
   * can therefore redraw the same visual without restarting playback.
   */
  get currentFrame(): AtlasFrame | undefined {
    return this.displayedFrame;
  }

  playClip(
    clip: AnimationClip,
    callbacks: AnimationPlaybackCallbacks = {},
  ): void {
    this.assertUsable();
    const durationMs = validateClipForPlayback(clip);

    if (clip.playback === "pose") {
      this.showPose(clip.frames[0]!);
      return;
    }

    this.cancelScheduledWork();
    const now = this.readMonotonicTime();
    const generation = this.nextGeneration();
    this.activePlayback = {
      generation,
      clip,
      durationMs,
      callbacks,
      startedAtMs: now,
      lastObservedAtMs: now,
      pausedElapsedMs: 0,
      renderedFrameIndex: undefined,
      completedLoopCount: 0,
    };
    this.playerStatus = "playing";
    this.queuePlaybackRender(generation);
  }

  showPose(frame: AtlasFrame): void {
    this.assertUsable();
    validatePose(frame);
    this.cancelScheduledWork();
    this.activePlayback = undefined;
    this.playerStatus = "pose";
    this.displayedFrame = frame;

    const generation = this.nextGeneration();
    const handle = this.timing.requestAnimationFrame(() => {
      if (this.animationFrameHandle === handle) {
        this.animationFrameHandle = undefined;
      }
      this.runAsynchronousWork(() => {
        if (this.playerStatus !== "pose" || this.generation !== generation) {
          return;
        }
        this.renderFrame(frame);
      });
    });
    this.animationFrameHandle = handle;
  }

  cancel(): void {
    if (this.playerStatus === "disposed") {
      return;
    }

    this.cancelScheduledWork();
    this.nextGeneration();
    this.activePlayback = undefined;
    this.playerStatus = "stopped";
  }

  pause(): void {
    if (this.playerStatus === "pose") {
      // A pose has no frame-boundary timer, but its one presentation RAF may
      // still be pending. Hidden/paused windows must own no browser callbacks.
      this.cancelScheduledWork();
      this.nextGeneration();
      this.activePlayback = undefined;
      this.playerStatus = "paused";
      return;
    }

    if (this.playerStatus !== "playing" || this.activePlayback === undefined) {
      return;
    }

    const now = this.readMonotonicTime();
    const playback = this.activePlayback;
    playback.pausedElapsedMs = this.getBoundedElapsedAtPause(playback, now);
    playback.lastObservedAtMs = now;
    this.cancelScheduledWork();
    // Invalidating the generation also rejects a browser callback that was already
    // dequeued just before clearTimeout/cancelAnimationFrame ran.
    playback.generation = this.nextGeneration();
    this.playerStatus = "paused";
  }

  resume(): void {
    if (this.playerStatus !== "paused") {
      return;
    }

    if (this.activePlayback === undefined) {
      const pose = this.displayedFrame;
      if (pose === undefined) {
        this.playerStatus = "stopped";
        return;
      }

      // showPose creates one fresh RAF and invalidates any callback captured
      // before pause; it never arms a recurring frame timer.
      this.showPose(pose);
      return;
    }

    const now = this.readMonotonicTime();
    this.activePlayback.startedAtMs = now - this.activePlayback.pausedElapsedMs;
    this.activePlayback.lastObservedAtMs = now;
    this.playerStatus = "playing";
    this.queuePlaybackRender(this.activePlayback.generation);
  }

  dispose(): void {
    if (this.playerStatus === "disposed") {
      return;
    }

    this.cancelScheduledWork();
    this.nextGeneration();
    this.activePlayback = undefined;
    this.playerStatus = "disposed";
  }

  private queuePlaybackRender(generation: number): void {
    if (
      this.animationFrameHandle !== undefined ||
      this.playerStatus !== "playing" ||
      this.activePlayback?.generation !== generation
    ) {
      return;
    }

    const handle = this.timing.requestAnimationFrame(() => {
      if (this.animationFrameHandle === handle) {
        this.animationFrameHandle = undefined;
      }
      this.runAsynchronousWork(() => {
        this.renderPlaybackAtCurrentTime(generation);
      });
    });
    this.animationFrameHandle = handle;
  }

  private renderPlaybackAtCurrentTime(generation: number): void {
    const playback = this.activePlayback;
    if (
      this.playerStatus !== "playing" ||
      playback === undefined ||
      playback.generation !== generation
    ) {
      return;
    }

    const now = this.readMonotonicTime();
    let elapsedMs = Math.max(0, now - playback.startedAtMs);
    const observationGapMs = Math.max(0, now - playback.lastObservedAtMs);
    playback.lastObservedAtMs = now;

    if (observationGapMs > this.maximumCatchUpMs) {
      if (playback.clip.playback === "once") {
        this.completePlayback(playback);
        return;
      }

      // After a long system sleep, restart a loop from a known boundary instead
      // of presenting an arbitrary modulo position or replaying missed frames.
      playback.startedAtMs = now;
      elapsedMs = 0;
      playback.completedLoopCount = 0;
    }

    if (playback.clip.playback === "once" && elapsedMs >= playback.durationMs) {
      this.completePlayback(playback);
      return;
    }

    if (playback.clip.playback === "loop") {
      const completedLoopCount = Math.floor(elapsedMs / playback.durationMs);
      if (completedLoopCount > playback.completedLoopCount) {
        // Report at most one observed boundary even if a late timer skipped several
        // loops. PetRuntime needs a safe replacement point, not replayed history.
        playback.completedLoopCount = completedLoopCount;
        playback.callbacks.onLoopBoundary?.(playback.clip.id);

        // A boundary listener may replace idle with a settle pose or action. Never
        // let the old generation draw or arm another timeout afterward.
        if (
          this.playerStatus !== "playing" ||
          this.activePlayback?.generation !== generation
        ) {
          return;
        }
      }
    }

    const location = locateFrame(playback, elapsedMs);
    const frame = playback.clip.frames[location.frameIndex]!;
    if (playback.renderedFrameIndex !== location.frameIndex) {
      playback.renderedFrameIndex = location.frameIndex;
      this.displayedFrame = frame;
      this.renderFrame(frame);
    }

    // Rendering callbacks are application code and may replace or cancel playback.
    // Recheck the generation before arming the next native browser timeout.
    if (
      this.playerStatus === "playing" &&
      this.activePlayback?.generation === generation
    ) {
      const handle = this.timing.setTimeout(() => {
        if (this.timeoutHandle === handle) {
          this.timeoutHandle = undefined;
        }
        this.runAsynchronousWork(() => {
          this.queuePlaybackRender(generation);
        });
      }, location.millisecondsUntilNextFrame);
      this.timeoutHandle = handle;
    }
  }

  private completePlayback(playback: ActivePlayback): void {
    if (
      this.playerStatus !== "playing" ||
      this.activePlayback?.generation !== playback.generation
    ) {
      return;
    }

    this.cancelScheduledWork();
    this.activePlayback = undefined;
    this.playerStatus = "stopped";
    this.nextGeneration();

    // Clear owned state before notifying. A completion listener may immediately
    // start idle or another action without colliding with the completed generation.
    playback.callbacks.onComplete?.(playback.clip.id);
  }

  private getBoundedElapsedAtPause(playback: ActivePlayback, now: number): number {
    const elapsedMs = Math.max(0, now - playback.startedAtMs);
    const observationGapMs = Math.max(0, now - playback.lastObservedAtMs);
    if (observationGapMs <= this.maximumCatchUpMs) {
      return elapsedMs;
    }
    if (playback.clip.playback === "once") {
      return playback.durationMs;
    }

    // A loop resumes from elapsed zero after a long sleep. Its boundary counter
    // must restart from the same origin, otherwise a pending action could wait for
    // every pre-sleep loop count to be reached again before seeing a boundary.
    playback.completedLoopCount = 0;
    return 0;
  }

  private cancelScheduledWork(): void {
    if (this.timeoutHandle !== undefined) {
      this.timing.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    if (this.animationFrameHandle !== undefined) {
      this.timing.cancelAnimationFrame(this.animationFrameHandle);
      this.animationFrameHandle = undefined;
    }
  }

  private runAsynchronousWork(work: () => void): void {
    try {
      work();
    } catch (error: unknown) {
      this.failClosed(error);
    }
  }

  private failClosed(error: unknown): void {
    // A renderer or application callback is outside the timing state machine.
    // Cancel first so an exception can never leave a "playing" generation with
    // neither a timer nor RAF, or preserve work scheduled by a half-run callback.
    this.cancelScheduledWork();
    this.nextGeneration();
    this.activePlayback = undefined;
    if (this.playerStatus !== "disposed") {
      this.playerStatus = "stopped";
    }

    if (this.fatalErrorReported) {
      return;
    }
    this.fatalErrorReported = true;

    if (this.onFatalError === undefined) {
      // Standalone callers still receive an uncaught asynchronous error after the
      // player has reached a safe stopped state.
      throw error;
    }

    try {
      this.onFatalError(error);
    } catch {
      // Error reporting is the last boundary. A faulty reporter must not revive
      // animation work or start an exception-reporting loop.
    }
  }

  private nextGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  private readMonotonicTime(): number {
    const now = this.timing.now();
    if (!Number.isFinite(now) || now < 0) {
      throw new RangeError("Animation timing must return a finite nonnegative time");
    }
    return now;
  }

  private assertUsable(): void {
    if (this.playerStatus === "disposed") {
      throw new Error("AnimationPlayer has been disposed");
    }
  }
}

function validateClipForPlayback(clip: AnimationClip): number {
  if (clip.frames.length === 0) {
    throw new RangeError(`Animation clip "${clip.id}" must contain at least one frame`);
  }
  if (!["loop", "once", "pose"].includes(clip.playback)) {
    throw new RangeError(`Animation clip "${clip.id}" has unsupported playback`);
  }
  if (clip.playback === "pose" && clip.frames.length !== 1) {
    throw new RangeError(`Pose clip "${clip.id}" must contain exactly one frame`);
  }

  let durationMs = 0;
  for (const frame of clip.frames) {
    validatePose(frame);
    if (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0) {
      throw new RangeError(`Animation clip "${clip.id}" has an invalid frame duration`);
    }
    durationMs += frame.durationMs;
  }

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`Animation clip "${clip.id}" has an invalid total duration`);
  }
  return durationMs;
}

function validatePose(frame: AtlasFrame): void {
  if (
    !Number.isFinite(frame.row) ||
    !Number.isInteger(frame.row) ||
    frame.row < 0 ||
    !Number.isFinite(frame.column) ||
    !Number.isInteger(frame.column) ||
    frame.column < 0
  ) {
    throw new RangeError("Animation pose coordinates must be nonnegative integers");
  }
}

function locateFrame(playback: ActivePlayback, elapsedMs: number): FrameLocation {
  const clipElapsedMs =
    playback.clip.playback === "loop"
      ? elapsedMs % playback.durationMs
      : elapsedMs;

  let frameEndMs = 0;
  for (let frameIndex = 0; frameIndex < playback.clip.frames.length; frameIndex += 1) {
    const frame = playback.clip.frames[frameIndex]!;
    frameEndMs += frame.durationMs;
    if (clipElapsedMs < frameEndMs) {
      return {
        frameIndex,
        millisecondsUntilNextFrame: frameEndMs - clipElapsedMs,
      };
    }
  }

  // One-shot completion is handled before this helper. This guard documents the
  // invariant and protects future callers from indexing past the final frame.
  throw new RangeError(`Elapsed time exceeds animation clip "${playback.clip.id}"`);
}

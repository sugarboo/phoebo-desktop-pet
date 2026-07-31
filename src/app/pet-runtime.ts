import {
  AnimationPlayer,
  type AnimationFrameRenderer,
  type AnimationTiming,
} from "../animation/animation-player.js";
import type {
  AnimationClip,
  AnimationProfile,
  AtlasFrame,
} from "../animation/animation-profile.js";
import type { BehaviorProfile } from "../behavior/behavior-profile.js";
import {
  BehaviorScheduler,
  type BehaviorActionSelection,
  type BehaviorSchedulerDependencies,
} from "../behavior/behavior-scheduler.js";

export interface PetRuntimeDependencies {
  readonly animationTiming?: AnimationTiming;
  readonly behaviorScheduling?: BehaviorSchedulerDependencies;
  readonly onFatalError?: ((error: unknown) => void) | undefined;
}

export type PetRuntimeStatus =
  | "stopped"
  | "running"
  | "paused"
  | "failed"
  | "disposed";
export type PetRuntimePhase =
  | "idle"
  | "waiting-for-idle-boundary"
  | "settling-before-action"
  | "action"
  | "settling-after-action"
  | "drag-control";
export type DragMotionDirection = "left" | "right";

const SETTLE_BEFORE_CLIP_ID = "settle-before-action";
const SETTLE_AFTER_CLIP_ID = "settle-after-action";

/**
 * Coordinates animation and behavior without taking ownership of either algorithm.
 *
 * This is the application state machine: AnimationPlayer decides which frame is
 * current, BehaviorScheduler decides when/what to play, and PetRuntime connects
 * their lifecycle transitions.
 */
export class PetRuntime {
  private readonly player: AnimationPlayer;
  private readonly scheduler: BehaviorScheduler;
  private readonly defaultClip: AnimationClip;
  private readonly settleBeforeActionClip: AnimationClip | undefined;
  private readonly settleAfterActionClip: AnimationClip | undefined;
  private readonly dragLeftClip: AnimationClip;
  private readonly dragRightClip: AnimationClip;
  private readonly reportFatalError: ((error: unknown) => void) | undefined;
  private runtimeStatus: PetRuntimeStatus = "stopped";
  private runtimePhase: PetRuntimePhase = "idle";
  private activeSelection: BehaviorActionSelection | undefined;
  private dragControlActive = false;
  private dragMotionDirection: DragMotionDirection | undefined;
  private fatalErrorReported = false;

  constructor(
    private readonly animationProfile: AnimationProfile,
    behaviorProfile: BehaviorProfile,
    renderFrame: AnimationFrameRenderer,
    dependencies: PetRuntimeDependencies = {},
  ) {
    this.defaultClip = requireClip(
      animationProfile.clips,
      behaviorProfile.defaultClipId,
    );
    this.dragLeftClip = requireClip(
      animationProfile.clips,
      behaviorProfile.dragMotion.leftClipId,
    );
    this.dragRightClip = requireClip(
      animationProfile.clips,
      behaviorProfile.dragMotion.rightClipId,
    );
    this.reportFatalError = dependencies.onFatalError;
    this.settleBeforeActionClip = createSettleClip(
      SETTLE_BEFORE_CLIP_ID,
      animationProfile.atlas.neutralFrame,
      behaviorProfile.cadence.settleBeforeActionMs,
    );
    this.settleAfterActionClip = createSettleClip(
      SETTLE_AFTER_CLIP_ID,
      animationProfile.atlas.neutralFrame,
      behaviorProfile.cadence.settleAfterActionMs,
    );
    const onFatalError = (error: unknown): void => {
      this.failClosed(error, dependencies.onFatalError);
    };
    this.player = new AnimationPlayer(
      renderFrame,
      dependencies.animationTiming,
      { onFatalError },
    );

    const onActionSelected = (selection: BehaviorActionSelection): void => {
      this.playSelectedAction(selection);
    };
    this.scheduler = new BehaviorScheduler(
      behaviorProfile,
      onActionSelected,
      dependencies.behaviorScheduling,
      onFatalError,
    );
  }

  get status(): PetRuntimeStatus {
    return this.runtimeStatus;
  }

  get phase(): PetRuntimePhase {
    return this.runtimePhase;
  }

  /**
   * Canvas backing-store changes can redraw this frame without restarting either
   * state machine or briefly flashing the neutral loading pose.
   */
  get currentFrame(): AtlasFrame | undefined {
    return this.player.currentFrame;
  }

  start(): void {
    this.assertUsable();
    if (this.runtimeStatus !== "stopped") {
      return;
    }

    this.runtimeStatus = "running";
    try {
      this.playIdle();
      this.scheduler.start();
    } catch (error: unknown) {
      // Leave construction/startup failures in a fully stopped state so bootstrap
      // can report one useful error without leaking a partially armed timer.
      this.scheduler.stop();
      this.player.cancel();
      this.runtimeStatus = "stopped";
      throw error;
    }
  }

  pause(): void {
    if (this.runtimeStatus !== "running") {
      return;
    }

    this.runtimeStatus = "paused";
    // Pause selection first: no new action can begin while playback is being paused.
    this.scheduler.pause();
    this.player.pause();
  }

  resume(): void {
    if (this.runtimeStatus !== "paused") {
      return;
    }

    this.runtimeStatus = "running";
    if (this.dragControlActive) {
      // Direct control owns the visual and deliberately leaves random scheduling
      // stopped. AnimationPlayer resumes either the held pose or locomotion loop.
      this.runtimePhase = "drag-control";
      this.player.resume();
      return;
    }

    if (this.scheduler.status === "stopped") {
      // A drag can end while the native window is hidden or behavior is paused.
      // Re-enter a fresh idle hold instead of resuming the interrupted action.
      this.playIdle();
      this.scheduler.start();
      return;
    }

    // Resume the scheduler state before playback. If a random action was active,
    // its completion callback then finds the matching selection ready to complete.
    this.scheduler.resume();
    this.player.resume();
  }

  /**
   * Begin a high-priority owner interaction.
   *
   * Native dragging may start while a random action is pending, settling, or
   * playing. Stop the scheduler (rather than pausing it) so replacing that clip
   * cannot leave an action-active token with no future completion callback.
   */
  beginDragControl(): void {
    if (this.runtimeStatus !== "running" || this.dragControlActive) {
      return;
    }

    this.runInteractiveTransition(() => {
      this.dragControlActive = true;
      this.dragMotionDirection = undefined;
      this.activeSelection = undefined;
      this.scheduler.stop();
      this.runtimePhase = "drag-control";
      this.player.playClip(this.defaultClip);
    });
  }

  setDragControlDirection(direction: DragMotionDirection | undefined): void {
    if (!this.dragControlActive || this.dragMotionDirection === direction) {
      return;
    }

    this.dragMotionDirection = direction;
    if (this.runtimeStatus !== "running") {
      return;
    }

    this.runInteractiveTransition(() => {
      this.runtimePhase = "drag-control";
      const clip =
        direction === "left"
          ? this.dragLeftClip
          : direction === "right"
            ? this.dragRightClip
            : this.defaultClip;
      this.player.playClip(clip);
    });
  }

  endDragControl(): void {
    if (!this.dragControlActive) {
      return;
    }

    this.dragControlActive = false;
    this.dragMotionDirection = undefined;
    this.activeSelection = undefined;

    if (this.runtimeStatus === "paused") {
      // There is no scheduler state to resume because beginDragControl stopped it.
      // Clear the locomotion clip; resume() will start a fresh idle delay.
      this.player.cancel();
      this.runtimePhase = "idle";
      return;
    }
    if (this.runtimeStatus !== "running") {
      return;
    }

    this.runInteractiveTransition(() => {
      this.playIdle();
      this.scheduler.start();
    });
  }

  dispose(): void {
    if (this.runtimeStatus === "disposed") {
      return;
    }

    // Mark disposed before cancelling work so even an unusually eager platform
    // callback cannot start another animation during shutdown.
    this.runtimeStatus = "disposed";
    this.activeSelection = undefined;
    this.dragControlActive = false;
    this.dragMotionDirection = undefined;
    this.scheduler.dispose();
    this.player.dispose();
  }

  private playSelectedAction(selection: BehaviorActionSelection): void {
    if (this.runtimeStatus !== "running") {
      return;
    }
    if (this.runtimePhase !== "idle") {
      throw new Error(
        `Cannot queue an action while runtime phase is "${this.runtimePhase}"`,
      );
    }

    this.activeSelection = selection;
    this.runtimePhase = "waiting-for-idle-boundary";
    if (this.defaultClip.playback === "pose") {
      // A static pose is already a safe transition point. Waiting for a loop
      // boundary that can never occur would strand the scheduler in pending state.
      this.beginPendingActionTransition(selection.selectionId);
    }
  }

  private handleIdleLoopBoundary(): void {
    if (
      this.runtimeStatus !== "running" ||
      this.runtimePhase !== "waiting-for-idle-boundary" ||
      this.activeSelection === undefined
    ) {
      return;
    }

    this.beginPendingActionTransition(this.activeSelection.selectionId);
  }

  private beginPendingActionTransition(selectionId: number): void {
    const selection = this.activeSelection;
    if (
      this.runtimeStatus !== "running" ||
      this.runtimePhase !== "waiting-for-idle-boundary" ||
      selection?.selectionId !== selectionId
    ) {
      return;
    }

    if (
      selection.action.transition === "direct" ||
      this.settleBeforeActionClip === undefined
    ) {
      this.startPendingAction(selectionId);
      return;
    }

    this.runtimePhase = "settling-before-action";
    // A one-frame once clip gives the neutral pose a real duration while reusing
    // AnimationPlayer's pause, resume, cancellation, and stale-callback protection.
    this.player.playClip(this.settleBeforeActionClip, {
      onComplete: () => this.startPendingAction(selectionId),
    });
  }

  private startPendingAction(selectionId: number): void {
    const selection = this.activeSelection;
    if (
      this.runtimeStatus !== "running" ||
      selection?.selectionId !== selectionId ||
      (this.runtimePhase !== "waiting-for-idle-boundary" &&
        this.runtimePhase !== "settling-before-action")
    ) {
      return;
    }

    const actionClip = requireClip(
      this.animationProfile.clips,
      selection.action.clipId,
    );
    if (!this.scheduler.startAction(selectionId)) {
      throw new Error(`Behavior selection ${selectionId} could not begin`);
    }

    this.runtimePhase = "action";
    this.player.playClip(actionClip, {
      onComplete: () => this.finishActionPlayback(selectionId),
    });
  }

  private finishActionPlayback(selectionId: number): void {
    if (
      this.runtimeStatus !== "running" ||
      this.runtimePhase !== "action" ||
      this.activeSelection?.selectionId !== selectionId
    ) {
      return;
    }

    if (
      this.activeSelection.action.transition === "direct" ||
      this.settleAfterActionClip === undefined
    ) {
      this.restoreIdle(selectionId);
      return;
    }

    this.runtimePhase = "settling-after-action";
    this.player.playClip(this.settleAfterActionClip, {
      onComplete: () => this.restoreIdle(selectionId),
    });
  }

  private restoreIdle(selectionId: number): void {
    if (
      this.runtimeStatus !== "running" ||
      (this.runtimePhase !== "settling-after-action" &&
        this.runtimePhase !== "action") ||
      this.activeSelection?.selectionId !== selectionId
    ) {
      return;
    }

    this.activeSelection = undefined;
    this.playIdle();
    if (!this.scheduler.completeAction(selectionId)) {
      throw new Error(`Behavior selection ${selectionId} could not complete`);
    }
  }

  private playIdle(): void {
    this.runtimePhase = "idle";
    if (this.defaultClip.playback === "loop") {
      this.player.playClip(this.defaultClip, {
        onLoopBoundary: () => this.handleIdleLoopBoundary(),
      });
    } else {
      this.player.playClip(this.defaultClip);
    }
  }

  private failClosed(
    error: unknown,
    reportFatalError: ((error: unknown) => void) | undefined,
  ): void {
    if (this.runtimeStatus === "disposed" || this.fatalErrorReported) {
      return;
    }

    // Mark failed before disposing both owners. Any callback already dequeued by
    // the browser then observes a terminal runtime state and cannot transition it.
    this.fatalErrorReported = true;
    this.runtimeStatus = "failed";
    this.activeSelection = undefined;
    this.dragControlActive = false;
    this.dragMotionDirection = undefined;
    this.scheduler.dispose();
    this.player.dispose();

    try {
      reportFatalError?.(error);
    } catch {
      // The runtime is already fully stopped. Do not let diagnostics create a
      // second failure path or re-arm work.
    }
  }

  private assertUsable(): void {
    if (this.runtimeStatus === "disposed") {
      throw new Error("PetRuntime has been disposed");
    }
    if (this.runtimeStatus === "failed") {
      throw new Error("PetRuntime is failed");
    }
  }

  private runInteractiveTransition(transition: () => void): void {
    try {
      transition();
    } catch (error: unknown) {
      this.failClosed(error, this.reportFatalError);
    }
  }
}

function createSettleClip(
  id: string,
  neutralFrame: AtlasFrame,
  durationMs: number,
): AnimationClip | undefined {
  if (durationMs === 0) {
    return undefined;
  }

  return Object.freeze({
    id,
    playback: "once",
    frames: Object.freeze([
      Object.freeze({
        ...neutralFrame,
        durationMs,
      }),
    ]),
  });
}

function requireClip(
  clips: Readonly<Record<string, AnimationClip>>,
  clipId: string,
): AnimationClip {
  const clip = clips[clipId];
  if (clip === undefined) {
    throw new Error(`Required animation clip "${clipId}" was not found`);
  }
  return clip;
}

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
}

export type PetRuntimeStatus = "stopped" | "running" | "paused" | "disposed";
export type PetRuntimePhase =
  | "idle"
  | "waiting-for-idle-boundary"
  | "settling-before-action"
  | "action"
  | "settling-after-action";

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
  private runtimeStatus: PetRuntimeStatus = "stopped";
  private runtimePhase: PetRuntimePhase = "idle";
  private activeSelection: BehaviorActionSelection | undefined;

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
    this.player =
      dependencies.animationTiming === undefined
        ? new AnimationPlayer(renderFrame)
        : new AnimationPlayer(renderFrame, dependencies.animationTiming);

    const onActionSelected = (selection: BehaviorActionSelection): void => {
      this.playSelectedAction(selection);
    };
    this.scheduler =
      dependencies.behaviorScheduling === undefined
        ? new BehaviorScheduler(behaviorProfile, onActionSelected)
        : new BehaviorScheduler(
            behaviorProfile,
            onActionSelected,
            dependencies.behaviorScheduling,
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
    // Resume the scheduler state before playback. If an action was active, its
    // completion callback will then find the matching selection ready to complete.
    this.scheduler.resume();
    this.player.resume();
  }

  dispose(): void {
    if (this.runtimeStatus === "disposed") {
      return;
    }

    // Mark disposed before cancelling work so even an unusually eager platform
    // callback cannot start another animation during shutdown.
    this.runtimeStatus = "disposed";
    this.activeSelection = undefined;
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
  }

  private handleIdleLoopBoundary(): void {
    if (
      this.runtimeStatus !== "running" ||
      this.runtimePhase !== "waiting-for-idle-boundary" ||
      this.activeSelection === undefined
    ) {
      return;
    }

    const selectionId = this.activeSelection.selectionId;
    if (this.settleBeforeActionClip === undefined) {
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

    if (this.settleAfterActionClip === undefined) {
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
    this.player.playClip(this.defaultClip, {
      onLoopBoundary: () => this.handleIdleLoopBoundary(),
    });
  }

  private assertUsable(): void {
    if (this.runtimeStatus === "disposed") {
      throw new Error("PetRuntime has been disposed");
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

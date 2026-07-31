export const BEHAVIOR_PROFILE_SCHEMA_VERSION = 3;

export type BehaviorActionTransition = "settled" | "direct";

export interface IdleDelayRange {
  readonly minimum: number;
  readonly maximum: number;
}

export interface BehaviorAction {
  readonly clipId: string;
  readonly weight: number;
  readonly cooldownMs: number;
  readonly interruptible: boolean;
  /**
   * Most actions use the neutral settle pose. A direct action is authored to join
   * the default pose without that intermediate frame, such as Phoebo's blink.
   */
  readonly transition: BehaviorActionTransition;
}

export interface BehaviorCadence {
  readonly avoidImmediateRepeat: boolean;
  readonly settleBeforeActionMs: number;
  readonly settleAfterActionMs: number;
}

export interface DragMotionBehavior {
  readonly leftClipId: string;
  readonly rightClipId: string;
  /**
   * Delay after the last horizontal native-window move before the run returns to
   * the default pose. The same delay spaces left-button release checks while held.
   */
  readonly stopDelayMs: number;
}

/**
 * Behavior configuration deliberately contains no sprite coordinates. A skin can
 * reuse the same animation layout while independently tuning how often actions run.
 */
export interface BehaviorProfile {
  readonly schemaVersion: number;
  readonly id: string;
  readonly defaultClipId: string;
  readonly idleDelayMs: IdleDelayRange;
  readonly cadence: BehaviorCadence;
  readonly dragMotion: DragMotionBehavior;
  readonly actions: readonly BehaviorAction[];
}

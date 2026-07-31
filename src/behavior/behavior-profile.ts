export const BEHAVIOR_PROFILE_SCHEMA_VERSION = 2;

export interface IdleDelayRange {
  readonly minimum: number;
  readonly maximum: number;
}

export interface BehaviorAction {
  readonly clipId: string;
  readonly weight: number;
  readonly cooldownMs: number;
  readonly interruptible: boolean;
}

export interface BehaviorCadence {
  readonly avoidImmediateRepeat: boolean;
  readonly settleBeforeActionMs: number;
  readonly settleAfterActionMs: number;
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
  readonly actions: readonly BehaviorAction[];
}

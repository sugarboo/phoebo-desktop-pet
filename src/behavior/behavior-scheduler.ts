import type {
  BehaviorAction,
  BehaviorProfile,
} from "./behavior-profile.js";

export interface Clock {
  now(): number;
}

export interface RandomSource {
  /**
   * Return a value in the half-open range [0, 1), matching Math.random().
   */
  next(): number;
}

export interface TimeoutScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface BehaviorSchedulerDependencies {
  readonly clock: Clock;
  readonly randomSource: RandomSource;
  readonly timers: TimeoutScheduler;
}

export interface BehaviorActionSelection {
  /**
   * A unique token for this occurrence, even when the same clip is selected twice.
   * PetRuntime will return this token on completion so an old animation callback
   * cannot accidentally complete a newer action.
   */
  readonly selectionId: number;
  readonly action: BehaviorAction;
}

export type BehaviorActionListener = (selection: BehaviorActionSelection) => void;
export type BehaviorSchedulerStatus =
  | "stopped"
  | "waiting"
  | "action-pending"
  | "action-active"
  | "paused"
  | "disposed";

type PausedState =
  | { readonly kind: "waiting"; readonly remainingDelayMs: number }
  | { readonly kind: "action-pending" }
  | { readonly kind: "action-active" };

const MAX_BROWSER_TIMEOUT_MS = 2_147_483_647;

const browserDependencies: BehaviorSchedulerDependencies = {
  clock: {
    // performance.now() is monotonic, unlike Date.now(), so wall-clock corrections
    // cannot unexpectedly expire or extend cooldowns.
    now: () => performance.now(),
  },
  randomSource: {
    next: () => Math.random(),
  },
  timers: {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
  },
};

/**
 * Owns random-action timing and cooldown state without knowing about Canvas or Tauri.
 *
 * A scheduled timeout chooses a pending action. PetRuntime later confirms the real
 * playback boundary with startAction(), then returns the token on completion.
 */
export class BehaviorScheduler {
  private schedulerStatus: BehaviorSchedulerStatus = "stopped";
  private generation = 0;
  private nextSelectionId = 1;
  private timeoutHandle: number | undefined;
  private nextActionAtMs: number | undefined;
  private pausedState: PausedState | undefined;
  private activeActionSelection: BehaviorActionSelection | undefined;
  private lastStartedClipId: string | undefined;
  private lastObservedTimeMs: number | undefined;
  private readonly cooldownUntilByClipId = new Map<string, number>();

  constructor(
    private readonly profile: BehaviorProfile,
    private readonly onActionSelected: BehaviorActionListener,
    private readonly dependencies: BehaviorSchedulerDependencies = browserDependencies,
    private readonly onFatalError?: (error: unknown) => void,
  ) {}

  get status(): BehaviorSchedulerStatus {
    return this.schedulerStatus;
  }

  get nextActionAt(): number | undefined {
    return this.nextActionAtMs;
  }

  get activeSelection(): BehaviorActionSelection | undefined {
    return this.activeActionSelection;
  }

  /**
   * Start is idempotent. Repeated lifecycle notifications therefore cannot multiply
   * scheduler timers.
   */
  start(): void {
    this.assertUsable();
    if (this.schedulerStatus !== "stopped") {
      return;
    }

    this.scheduleNextIdleDelay();
  }

  /**
   * Confirm that the pending clip is beginning now.
   *
   * Cooldown starts here rather than at selection time because PetRuntime may keep
   * an action pending until the idle loop reaches a visually safe boundary.
   */
  startAction(selectionId: number): boolean {
    if (
      this.schedulerStatus !== "action-pending" ||
      this.activeActionSelection?.selectionId !== selectionId
    ) {
      return false;
    }

    const now = this.readMonotonicTime();
    const action = this.activeActionSelection.action;
    const cooldownUntilMs = now + action.cooldownMs;
    if (!Number.isFinite(cooldownUntilMs)) {
      throw new RangeError(`Cooldown deadline for "${action.clipId}" must be finite`);
    }

    this.cooldownUntilByClipId.set(action.clipId, cooldownUntilMs);
    this.lastStartedClipId = action.clipId;
    this.schedulerStatus = "action-active";
    return true;
  }

  /**
   * Mark the selected one-shot as finished and begin the next idle hold.
   *
   * Returning false is expected for duplicate or stale completion callbacks; it is
   * not an exceptional runtime failure.
   */
  completeAction(selectionId: number): boolean {
    if (
      this.schedulerStatus !== "action-active" ||
      this.activeActionSelection?.selectionId !== selectionId
    ) {
      return false;
    }

    this.activeActionSelection = undefined;
    this.schedulerStatus = "stopped";
    this.scheduleNextIdleDelay();
    return true;
  }

  pause(): void {
    if (this.schedulerStatus === "waiting") {
      const now = this.readMonotonicTime();
      const remainingDelayMs = Math.max(0, (this.nextActionAtMs ?? now) - now);
      this.cancelPendingTimeout();
      this.nextGeneration();
      this.nextActionAtMs = undefined;
      this.pausedState = Object.freeze({ kind: "waiting", remainingDelayMs });
      this.schedulerStatus = "paused";
      return;
    }

    if (
      this.schedulerStatus === "action-pending" ||
      this.schedulerStatus === "action-active"
    ) {
      this.nextGeneration();
      this.pausedState = Object.freeze({ kind: this.schedulerStatus });
      this.schedulerStatus = "paused";
    }
  }

  resume(): void {
    if (this.schedulerStatus !== "paused" || this.pausedState === undefined) {
      return;
    }

    const pausedState = this.pausedState;
    this.pausedState = undefined;
    if (pausedState.kind === "waiting") {
      this.scheduleWaitingTimeout(pausedState.remainingDelayMs);
    } else {
      this.schedulerStatus = pausedState.kind;
    }
  }

  stop(): void {
    if (this.schedulerStatus === "disposed") {
      return;
    }

    this.cancelPendingTimeout();
    this.nextGeneration();
    this.nextActionAtMs = undefined;
    this.pausedState = undefined;
    this.activeActionSelection = undefined;
    this.schedulerStatus = "stopped";
  }

  dispose(): void {
    if (this.schedulerStatus === "disposed") {
      return;
    }

    this.stop();
    this.schedulerStatus = "disposed";
  }

  private scheduleNextIdleDelay(): void {
    const { minimum, maximum } = this.profile.idleDelayMs;
    const delayMs =
      minimum === maximum
        ? minimum
        : minimum + this.readRandomUnit() * (maximum - minimum);
    this.scheduleWaitingTimeout(delayMs);
  }

  private scheduleWaitingTimeout(delayMs: number, observedNow?: number): void {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError("Behavior timeout delay must be finite and nonnegative");
    }

    this.cancelPendingTimeout();
    const now = observedNow ?? this.readMonotonicTime();
    const generation = this.nextGeneration();
    const dueAtMs = now + delayMs;
    if (!Number.isFinite(dueAtMs)) {
      throw new RangeError("Behavior timeout deadline must be finite");
    }

    this.nextActionAtMs = dueAtMs;
    this.schedulerStatus = "waiting";

    // Browsers clamp very large delays. Waking at most once per clamp interval and
    // rechecking the absolute deadline avoids both overflow and a tight retry loop.
    const browserDelayMs = Math.min(delayMs, MAX_BROWSER_TIMEOUT_MS);
    const handle = this.dependencies.timers.setTimeout(() => {
      // A captured stale callback must never clear a newer timeout handle that was
      // installed by pause/resume or by a synchronous action completion.
      if (this.timeoutHandle === handle) {
        this.timeoutHandle = undefined;
      }
      this.handleTimeout(generation);
    }, browserDelayMs);
    this.timeoutHandle = handle;
  }

  private handleTimeout(generation: number): void {
    if (this.schedulerStatus !== "waiting" || this.generation !== generation) {
      return;
    }

    const now = this.readMonotonicTime();
    const dueAtMs = this.nextActionAtMs;
    if (dueAtMs === undefined) {
      return;
    }

    // A timer can fire early because of platform clamping or test fakes. Preserve
    // the original absolute deadline instead of selecting an action prematurely.
    if (now < dueAtMs) {
      this.scheduleWaitingTimeout(dueAtMs - now, now);
      return;
    }

    const eligibleActions = this.profile.actions.filter(
      (action) => (this.cooldownUntilByClipId.get(action.clipId) ?? 0) <= now,
    );
    if (eligibleActions.length === 0) {
      const earliestCooldownEnd = Math.min(
        ...this.profile.actions.map(
          (action) => this.cooldownUntilByClipId.get(action.clipId) ?? now,
        ),
      );
      this.scheduleWaitingTimeout(Math.max(0, earliestCooldownEnd - now), now);
      return;
    }

    const selectableActions = this.withoutImmediateRepeatWhenPossible(
      eligibleActions,
    );
    const action = this.selectWeightedAction(selectableActions);

    const selection = Object.freeze({
      selectionId: this.nextSelectionId++,
      action,
    });
    this.nextActionAtMs = undefined;
    this.activeActionSelection = selection;
    this.schedulerStatus = "action-pending";

    // State is fully updated before notification. The listener may synchronously
    // confirm playback in a deterministic test or queue it in PetRuntime.
    this.notifyActionSelected(selection);
  }

  private withoutImmediateRepeatWhenPossible(
    actions: readonly BehaviorAction[],
  ): readonly BehaviorAction[] {
    if (
      !this.profile.cadence.avoidImmediateRepeat ||
      this.lastStartedClipId === undefined ||
      actions.length < 2
    ) {
      return actions;
    }

    const alternatives = actions.filter(
      (action) => action.clipId !== this.lastStartedClipId,
    );
    return alternatives.length > 0 ? alternatives : actions;
  }

  private selectWeightedAction(actions: readonly BehaviorAction[]): BehaviorAction {
    const totalWeight = actions.reduce((total, action) => total + action.weight, 0);
    const target = this.readRandomUnit() * totalWeight;
    let cumulativeWeight = 0;

    for (const action of actions) {
      cumulativeWeight += action.weight;
      if (target < cumulativeWeight) {
        return action;
      }
    }

    // Floating-point addition can round the final boundary by a few ulps. Returning
    // the last action keeps selection total without biasing ordinary samples.
    return actions[actions.length - 1]!;
  }

  private readMonotonicTime(): number {
    const now = this.dependencies.clock.now();
    if (!Number.isFinite(now) || now < 0) {
      throw new RangeError("Behavior clock must return a finite nonnegative time");
    }
    if (this.lastObservedTimeMs !== undefined && now < this.lastObservedTimeMs) {
      throw new RangeError("Behavior clock must not move backwards");
    }
    this.lastObservedTimeMs = now;
    return now;
  }

  private readRandomUnit(): number {
    const random = this.dependencies.randomSource.next();
    if (!Number.isFinite(random) || random < 0 || random >= 1) {
      throw new RangeError("Random source must return a finite value in [0, 1)");
    }
    return random;
  }

  private cancelPendingTimeout(): void {
    if (this.timeoutHandle !== undefined) {
      this.dependencies.timers.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
  }

  private nextGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  private notifyActionSelected(selection: BehaviorActionSelection): void {
    try {
      this.onActionSelected(selection);
    } catch (error: unknown) {
      // The application listener sits outside weighted-selection logic. Fail
      // closed before reporting so an exception cannot strand action-pending state.
      this.cancelPendingTimeout();
      this.nextGeneration();
      this.nextActionAtMs = undefined;
      this.pausedState = undefined;
      this.activeActionSelection = undefined;
      this.schedulerStatus = "stopped";
      if (this.onFatalError === undefined) {
        throw error;
      }
      try {
        this.onFatalError(error);
      } catch {
        // A reporter is outside scheduler ownership. The scheduler is already
        // stopped; swallowing a second exception prevents an error loop.
      }
    }
  }

  private assertUsable(): void {
    if (this.schedulerStatus === "disposed") {
      throw new Error("BehaviorScheduler has been disposed");
    }
  }
}

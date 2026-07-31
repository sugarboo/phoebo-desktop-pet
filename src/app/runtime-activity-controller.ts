export interface PausableRuntime {
  pause(): void;
  resume(): void;
}

export type RuntimeActivityListener = (runtimeAllowedToRun: boolean) => void;

/**
 * Combines independent reasons why animation work must remain paused.
 *
 * The native window can be hidden while the document visibility API is briefly
 * stale, and the owner can pause behavior while the window stays visible. Keeping
 * both signals here prevents either source from accidentally resuming the other.
 */
export class RuntimeActivityController {
  private active = false;
  private documentVisible = true;
  private nativeWindowVisible = false;
  private behaviorPausedByUser = false;
  private runtimeAllowedToRun = true;

  constructor(
    private readonly runtime: PausableRuntime,
    private readonly onActivityChanged: RuntimeActivityListener = () => undefined,
  ) {}

  setDocumentVisible(visible: boolean): void {
    this.documentVisible = visible;
    this.reconcile();
  }

  setNativeWindowVisible(visible: boolean): void {
    this.nativeWindowVisible = visible;
    this.reconcile();
  }

  setBehaviorPausedByUser(paused: boolean): void {
    this.behaviorPausedByUser = paused;
    this.reconcile();
  }

  /**
   * Activate only after PetRuntime.start(). Signals received during atlas loading
   * are retained, then applied exactly once to the newly started runtime.
   */
  activate(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.runtimeAllowedToRun = true;
    if (this.shouldRun()) {
      // Consumers such as the DPR redraw gate must learn the initial active state
      // even though PetRuntime itself is already running.
      this.onActivityChanged(true);
    } else {
      this.reconcile();
    }
  }

  deactivate(): void {
    if (this.active) {
      this.onActivityChanged(false);
    }
    this.active = false;
  }

  private reconcile(): void {
    if (!this.active) {
      return;
    }

    const shouldRun = this.shouldRun();
    if (shouldRun === this.runtimeAllowedToRun) {
      return;
    }

    this.runtimeAllowedToRun = shouldRun;
    if (shouldRun) {
      this.runtime.resume();
    } else {
      this.runtime.pause();
    }
    this.onActivityChanged(shouldRun);
  }

  private shouldRun(): boolean {
    return (
      this.documentVisible &&
      this.nativeWindowVisible &&
      !this.behaviorPausedByUser
    );
  }
}

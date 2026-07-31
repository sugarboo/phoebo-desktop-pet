/**
 * Defers a redraw requested by monitor/DPI changes while runtime work is paused.
 *
 * Only one bit of pending state is needed: several hidden resize notifications all
 * collapse into one draw of the latest frame when the pet becomes active again.
 */
export class DeferredRedraw {
  private enabled = false;
  private pending = false;
  private disposed = false;

  constructor(private readonly redraw: () => void) {}

  request(): void {
    if (this.disposed) {
      return;
    }
    if (!this.enabled) {
      this.pending = true;
      return;
    }

    this.redraw();
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) {
      return;
    }

    this.enabled = enabled;
    if (enabled && this.pending) {
      this.pending = false;
      this.redraw();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.pending = false;
  }
}

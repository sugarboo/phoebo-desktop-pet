import type {
  DesktopControlEvent,
  DesktopControlSource,
  StopDesktopControlSubscription,
} from "../platform/desktop-window-adapter.js";

/**
 * Subscribe first, then reconcile the native pause snapshot without overwriting a
 * newer event that arrived while the IPC snapshot Promise was in flight.
 */
export async function subscribeToDesktopControls(
  source: DesktopControlSource,
  listener: (event: DesktopControlEvent) => void,
): Promise<StopDesktopControlSubscription> {
  let behaviorPauseEventReceived = false;
  const stop = await source.subscribe((event) => {
    if (event.kind === "behavior-paused") {
      behaviorPauseEventReceived = true;
    }
    listener(event);
  });

  try {
    const initialBehaviorPaused = await source.readInitialBehaviorPaused();
    if (!behaviorPauseEventReceived) {
      listener({
        kind: "behavior-paused",
        paused: initialBehaviorPaused,
      });
    }
    return stop;
  } catch (error: unknown) {
    stop();
    throw error;
  }
}

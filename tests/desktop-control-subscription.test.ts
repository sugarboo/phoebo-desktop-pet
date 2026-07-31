import { subscribeToDesktopControls } from "../src/app/desktop-control-subscription.js";
import type {
  DesktopControlEvent,
  DesktopControlSource,
} from "../src/platform/desktop-window-adapter.js";
import {
  assertDeepEqual,
  assertEqual,
  test,
} from "./test-harness.js";

test("desktop pause event received during snapshot wins over stale snapshot", async () => {
  let deliverEvent: ((event: DesktopControlEvent) => void) | undefined;
  let resolveSnapshot: ((paused: boolean) => void) | undefined;
  const observed: DesktopControlEvent[] = [];
  const source: DesktopControlSource = {
    subscribe: async (listener) => {
      deliverEvent = listener;
      return () => undefined;
    },
    readInitialBehaviorPaused: () =>
      new Promise<boolean>((resolve) => {
        resolveSnapshot = resolve;
      }),
  };

  const subscription = subscribeToDesktopControls(source, (event) => {
    observed.push(event);
  });
  await Promise.resolve();
  deliverEvent?.({ kind: "behavior-paused", paused: true });
  resolveSnapshot?.(false);
  await subscription;

  assertDeepEqual(observed, [{ kind: "behavior-paused", paused: true }]);
});

test("desktop pause snapshot initializes state when no newer event arrives", async () => {
  const observed: DesktopControlEvent[] = [];
  const source: DesktopControlSource = {
    subscribe: async () => () => undefined,
    readInitialBehaviorPaused: async () => true,
  };

  await subscribeToDesktopControls(source, (event) => {
    observed.push(event);
  });

  assertDeepEqual(observed, [{ kind: "behavior-paused", paused: true }]);
});

test("desktop control subscription rolls back when snapshot fails", async () => {
  let stopCount = 0;
  const source: DesktopControlSource = {
    subscribe: async () => () => {
      stopCount += 1;
    },
    readInitialBehaviorPaused: async () => {
      throw new Error("snapshot failed");
    },
  };

  let rejected = false;
  try {
    await subscribeToDesktopControls(source, () => undefined);
  } catch {
    rejected = true;
  }

  assertEqual(rejected, true);
  assertEqual(stopCount, 1);
});

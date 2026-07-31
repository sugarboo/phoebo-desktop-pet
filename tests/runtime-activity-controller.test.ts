import { RuntimeActivityController } from "../src/app/runtime-activity-controller.js";
import { assertDeepEqual, test } from "./test-harness.js";

class RecordingRuntime {
  readonly calls: string[] = [];

  pause(): void {
    this.calls.push("pause");
  }

  resume(): void {
    this.calls.push("resume");
  }
}

test("activity controller applies signals received before runtime activation", () => {
  const runtime = new RecordingRuntime();
  const controller = new RuntimeActivityController(runtime);

  controller.setNativeWindowVisible(false);
  controller.setBehaviorPausedByUser(true);
  assertDeepEqual(runtime.calls, []);

  controller.activate();
  assertDeepEqual(runtime.calls, ["pause"]);
});

test("activity controller combines native, document, and owner pause reasons", () => {
  const runtime = new RecordingRuntime();
  const controller = new RuntimeActivityController(runtime);

  controller.setNativeWindowVisible(true);
  controller.activate();
  controller.setBehaviorPausedByUser(true);
  controller.setDocumentVisible(false);
  controller.setBehaviorPausedByUser(false);
  controller.setDocumentVisible(true);

  assertDeepEqual(runtime.calls, ["pause", "resume"]);
});

test("activity controller does not duplicate equivalent lifecycle transitions", () => {
  const runtime = new RecordingRuntime();
  const controller = new RuntimeActivityController(runtime);

  controller.activate();
  controller.setNativeWindowVisible(false);
  controller.setNativeWindowVisible(false);
  controller.setDocumentVisible(false);
  controller.setDocumentVisible(false);
  controller.setNativeWindowVisible(true);
  controller.setDocumentVisible(true);

  assertDeepEqual(runtime.calls, ["pause", "resume"]);
});

test("deactivated activity controller ignores late native events", () => {
  const runtime = new RecordingRuntime();
  const controller = new RuntimeActivityController(runtime);

  controller.setNativeWindowVisible(true);
  controller.activate();
  controller.deactivate();
  controller.setBehaviorPausedByUser(true);
  controller.setNativeWindowVisible(false);

  assertDeepEqual(runtime.calls, []);
});

test("activity controller reports initial and changed renderer activity", () => {
  const runtime = new RecordingRuntime();
  const activityChanges: boolean[] = [];
  const controller = new RuntimeActivityController(runtime, (allowed) => {
    activityChanges.push(allowed);
  });

  controller.setNativeWindowVisible(true);
  controller.activate();
  controller.setBehaviorPausedByUser(true);
  controller.setBehaviorPausedByUser(false);
  controller.deactivate();

  assertDeepEqual(activityChanges, [true, false, true, false]);
});

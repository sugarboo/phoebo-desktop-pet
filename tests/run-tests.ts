import "./animation-profile.test.js";
import "./animation-player.test.js";
import "./behavior-profile.test.js";
import "./behavior-scheduler.test.js";
import "./deferred-redraw.test.js";
import "./desktop-control-subscription.test.js";
import "./disposer-stack.test.js";
import "./drag-motion-controller.test.js";
import "./pet-runtime.test.js";
import "./rendering-contract.test.js";
import "./runtime-activity-controller.test.js";
import { runRegisteredTests } from "./test-harness.js";

await runRegisteredTests();

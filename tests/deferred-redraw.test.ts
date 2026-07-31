import { DeferredRedraw } from "../src/app/deferred-redraw.js";
import { assertEqual, test } from "./test-harness.js";

test("deferred redraw collapses hidden requests into one resume draw", () => {
  let redrawCount = 0;
  const redraw = new DeferredRedraw(() => {
    redrawCount += 1;
  });

  redraw.request();
  redraw.request();
  assertEqual(redrawCount, 0);

  redraw.setEnabled(true);
  assertEqual(redrawCount, 1);
  redraw.request();
  assertEqual(redrawCount, 2);
});

test("deferred redraw keeps no pending work after disposal", () => {
  let redrawCount = 0;
  const redraw = new DeferredRedraw(() => {
    redrawCount += 1;
  });

  redraw.request();
  redraw.dispose();
  redraw.setEnabled(true);
  redraw.request();

  assertEqual(redrawCount, 0);
});

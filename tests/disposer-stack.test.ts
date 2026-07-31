import { disposeInReverseOrder } from "../src/app/disposer-stack.js";
import { assertDeepEqual, test } from "./test-harness.js";

test("disposer stack releases in reverse order and continues after failure", () => {
  const calls: string[] = [];
  const errors: string[] = [];
  const failure = new Error("second cleanup failed");

  disposeInReverseOrder(
    [
      () => calls.push("first"),
      () => {
        calls.push("second");
        throw failure;
      },
      () => calls.push("third"),
    ],
    (error) => errors.push(error instanceof Error ? error.message : String(error)),
  );

  assertDeepEqual(calls, ["third", "second", "first"]);
  assertDeepEqual(errors, ["second cleanup failed"]);
});

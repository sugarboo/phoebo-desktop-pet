interface TestCase {
  readonly name: string;
  readonly body: () => void;
}

const testCases: TestCase[] = [];

export function test(name: string, body: () => void): void {
  testCases.push({ name, body });
}

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(message ?? `Expected ${expectedJson}, received ${actualJson}`);
  }
}

export function assertThrows(body: () => void, expectedMessagePart: string): void {
  try {
    body();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessagePart)) {
      throw new Error(
        `Expected error containing "${expectedMessagePart}", received "${message}"`,
      );
    }
    return;
  }

  throw new Error(`Expected an error containing "${expectedMessagePart}"`);
}

export function runRegisteredTests(): void {
  const failures: string[] = [];

  for (const testCase of testCases) {
    try {
      testCase.body();
      console.log(`PASS ${testCase.name}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      failures.push(`${testCase.name}\n${message}`);
      console.error(`FAIL ${testCase.name}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} test(s) failed:\n\n${failures.join("\n\n")}`);
  }

  console.log(`\n${testCases.length} test(s) passed`);
}

export type CleanupErrorListener = (error: unknown) => void;

/**
 * Release independently installed listeners in reverse order.
 *
 * Cleanup continues if one disposer fails, so a broken native unlisten cannot
 * prevent DOM, media-query, or runtime resources from being released.
 */
export function disposeInReverseOrder(
  disposers: readonly (() => void)[],
  onCleanupError: CleanupErrorListener = () => undefined,
): void {
  for (let index = disposers.length - 1; index >= 0; index -= 1) {
    try {
      disposers[index]!();
    } catch (error: unknown) {
      onCleanupError(error);
    }
  }
}

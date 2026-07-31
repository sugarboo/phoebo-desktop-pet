export interface DevicePixelRatioEnvironment {
  readPixelRatio(): number;
  subscribeToResolution(pixelRatio: number, listener: () => void): () => void;
  subscribeToResize(listener: () => void): () => void;
}

const browserDevicePixelRatioEnvironment: DevicePixelRatioEnvironment = {
  readPixelRatio: () => window.devicePixelRatio,
  subscribeToResolution: (pixelRatio, listener) => {
    // A resolution media query fires when the window leaves the DPR it was created
    // for. Resize is also observed below because WebView behavior varies by platform.
    const mediaQuery = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
    mediaQuery.addEventListener("change", listener);
    return () => {
      mediaQuery.removeEventListener("change", listener);
    };
  },
  subscribeToResize: (listener) => {
    window.addEventListener("resize", listener);
    return () => {
      window.removeEventListener("resize", listener);
    };
  },
};

export function observeDevicePixelRatio(
  onChange: (pixelRatio: number) => void,
  environment: DevicePixelRatioEnvironment = browserDevicePixelRatioEnvironment,
): () => void {
  // Dependencies are injectable so monitor changes and cleanup can be tested
  // deterministically without a real browser or a second physical display.
  let stopped = false;
  let currentPixelRatio = normalizeDevicePixelRatio(environment.readPixelRatio());
  let unsubscribeResolution = environment.subscribeToResolution(
    currentPixelRatio,
    evaluatePixelRatio,
  );
  let unsubscribeResize: () => void;
  try {
    unsubscribeResize = environment.subscribeToResize(evaluatePixelRatio);
  } catch (error: unknown) {
    // Installation is transactional: if the second browser subscription fails,
    // release the first one before propagating the startup error.
    unsubscribeResolution();
    throw error;
  }

  function evaluatePixelRatio(): void {
    if (stopped) {
      return;
    }

    const nextPixelRatio = normalizeDevicePixelRatio(environment.readPixelRatio());
    if (nextPixelRatio === currentPixelRatio) {
      return;
    }

    // A media query describes one specific DPR, so replace it after every change.
    unsubscribeResolution();
    currentPixelRatio = nextPixelRatio;
    unsubscribeResolution = environment.subscribeToResolution(
      currentPixelRatio,
      evaluatePixelRatio,
    );
    onChange(currentPixelRatio);
  }

  return () => {
    if (stopped) {
      return;
    }

    stopped = true;
    unsubscribeResolution();
    unsubscribeResize();
  };
}

export function normalizeDevicePixelRatio(pixelRatio: number): number {
  return Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
}

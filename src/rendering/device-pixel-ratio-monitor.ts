export interface DevicePixelRatioEnvironment {
  readPixelRatio(): number;
  subscribeToResolution(pixelRatio: number, listener: () => void): () => void;
  subscribeToResize(listener: () => void): () => void;
}

const browserDevicePixelRatioEnvironment: DevicePixelRatioEnvironment = {
  readPixelRatio: () => window.devicePixelRatio,
  subscribeToResolution: (pixelRatio, listener) => {
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
  let stopped = false;
  let currentPixelRatio = normalizeDevicePixelRatio(environment.readPixelRatio());
  let unsubscribeResolution = environment.subscribeToResolution(
    currentPixelRatio,
    evaluatePixelRatio,
  );
  const unsubscribeResize = environment.subscribeToResize(evaluatePixelRatio);

  function evaluatePixelRatio(): void {
    if (stopped) {
      return;
    }

    const nextPixelRatio = normalizeDevicePixelRatio(environment.readPixelRatio());
    if (nextPixelRatio === currentPixelRatio) {
      return;
    }

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

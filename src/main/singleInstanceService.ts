interface ConfigureSingleInstanceOptions {
  requestLock: () => boolean;
  quit: () => void;
  onSecondInstance: (listener: () => void) => void;
  showMainWindow: () => Promise<void>;
  onShowError?: (error: unknown) => void;
}

export function configureSingleInstance(options: ConfigureSingleInstanceOptions): boolean {
  if (!options.requestLock()) {
    options.quit();
    return false;
  }

  options.onSecondInstance(() => {
    void options.showMainWindow().catch((error: unknown) => {
      options.onShowError?.(error);
    });
  });
  return true;
}

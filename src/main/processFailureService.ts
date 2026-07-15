export interface DiagnosticErrorMetadata {
  [key: string]: unknown;
  name?: string;
  message?: string;
  code?: string | number;
  type?: string;
}

interface ProcessFailureHandlerOptions {
  logError(event: string, metadata: DiagnosticErrorMetadata): Promise<unknown> | unknown;
  logWarning(event: string, metadata: DiagnosticErrorMetadata): Promise<unknown> | unknown;
  showFatalError(): void;
  exit(code: number): void;
}

export interface ProcessFailureHandlers {
  handleUncaughtException(error: unknown): Promise<void>;
  handleUnhandledRejection(reason: unknown): Promise<void>;
}

export function createProcessFailureHandlers(options: ProcessFailureHandlerOptions): ProcessFailureHandlers {
  let fatalFailureInProgress = false;

  return {
    async handleUncaughtException(error) {
      if (fatalFailureInProgress) {
        options.exit(1);
        return;
      }
      fatalFailureInProgress = true;

      try {
        await options.logError("main.uncaught_exception", toDiagnosticErrorMetadata(error));
      } catch {
        // Fatal shutdown must continue even when diagnostics are unavailable.
      }
      try {
        options.showFatalError();
      } catch {
        // The process still exits if Electron cannot show the fatal dialog.
      }
      options.exit(1);
    },
    async handleUnhandledRejection(reason) {
      try {
        await options.logWarning("main.unhandled_rejection", toDiagnosticErrorMetadata(reason));
      } catch {
        // Logging failures must not create another unhandled rejection.
      }
    }
  };
}

export function toDiagnosticErrorMetadata(error: unknown): DiagnosticErrorMetadata {
  if (error instanceof Error) {
    const code = "code" in error && (typeof error.code === "string" || typeof error.code === "number")
      ? error.code
      : undefined;
    return {
      name: error.name || "Error",
      message: error.message,
      ...(code !== undefined ? { code } : {})
    };
  }

  return { type: error === null ? "null" : typeof error };
}

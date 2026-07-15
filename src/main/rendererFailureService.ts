export type RendererRecoveryAction = "retry" | "open_diagnostics" | "exit";

export type RendererFailure =
  | { kind: "load"; errorCode: number }
  | { kind: "renderer_exit"; reason: string; exitCode: number };

export interface RendererFailureController {
  handleLoadFailure(details: { errorCode: number; isMainFrame: boolean }): Promise<boolean>;
  handleRenderProcessGone(details: { reason: string; exitCode: number; isQuitting: boolean }): Promise<boolean>;
}

interface RendererFailureControllerOptions {
  reportFailure(failure: RendererFailure): Promise<unknown> | unknown;
  renderFallback(failure: RendererFailure): Promise<unknown> | unknown;
  showRecoveryPrompt(failure: RendererFailure): Promise<RendererRecoveryAction>;
  reloadRenderer(): Promise<unknown> | unknown;
  openDiagnosticsDirectory(): Promise<unknown> | unknown;
  quit(): void;
}

export function createRendererFailureController(options: RendererFailureControllerOptions): RendererFailureController {
  let recoveryInProgress = false;

  async function recover(failure: RendererFailure): Promise<boolean> {
    if (recoveryInProgress) {
      return false;
    }
    recoveryInProgress = true;

    try {
      await ignoreFailure(() => options.reportFailure(failure));
      await ignoreFailure(() => options.renderFallback(failure));

      let action: RendererRecoveryAction;
      try {
        action = await options.showRecoveryPrompt(failure);
      } catch {
        return true;
      }

      if (action === "retry") {
        await ignoreFailure(() => options.reloadRenderer());
      } else if (action === "open_diagnostics") {
        await ignoreFailure(() => options.openDiagnosticsDirectory());
      } else {
        await ignoreFailure(() => options.quit());
      }

      return true;
    } finally {
      recoveryInProgress = false;
    }
  }

  return {
    handleLoadFailure(details) {
      if (!details.isMainFrame || details.errorCode === -3) {
        return Promise.resolve(false);
      }

      return recover({ kind: "load", errorCode: details.errorCode });
    },
    handleRenderProcessGone(details) {
      if (details.isQuitting || details.reason === "clean-exit") {
        return Promise.resolve(false);
      }

      return recover({
        kind: "renderer_exit",
        reason: details.reason,
        exitCode: details.exitCode
      });
    }
  };
}

async function ignoreFailure(operation: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await operation();
  } catch {
    // A secondary recovery failure must not suppress the fallback flow.
  }
}

export function createRendererFallbackPageUrl(kind: RendererFailure["kind"]): string {
  const heading = kind === "load" ? "界面暂时无法加载" : "界面进程意外退出";
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>界面恢复</title>
    <style>
      :root { color-scheme: light; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; color: #f5f5f5; background: #eee4d0; }
      main { width: min(560px, 100%); border: 1px solid #39352f; border-radius: 6px; padding: 32px; background: #171717; box-shadow: 0 18px 46px rgba(45, 32, 20, .24); }
      h1 { margin: 0; font-size: 22px; font-weight: 650; }
      p { margin: 14px 0 0; color: #d4d4d4; font-size: 14px; line-height: 1.7; }
      small { display: block; margin-top: 18px; color: #fcd34d; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${heading}</h1>
      <p>账号凭据没有被修改。请在恢复提示中选择重新加载；如果问题仍然存在，可以打开诊断目录后重新启动应用。</p>
      <small>应用正在等待你的恢复选择。</small>
    </main>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function isNavigationAbortError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_ABORTED") {
    return true;
  }

  return error instanceof Error && /\bERR_ABORTED\b/u.test(error.message);
}

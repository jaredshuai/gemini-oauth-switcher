import { describe, expect, it, vi } from "vitest";
import {
  createRendererFailureController,
  createRendererFallbackPageUrl,
  isNavigationAbortError
} from "../src/main/rendererFailureService";

describe("rendererFailureService", () => {
  it("builds a static fallback page without accepting raw exception text", () => {
    const pageUrl = createRendererFallbackPageUrl("load");
    const html = decodeURIComponent(pageUrl.slice(pageUrl.indexOf(",") + 1));

    expect(pageUrl).toMatch(/^data:text\/html;charset=utf-8,/);
    expect(html).toContain("界面暂时无法加载");
    expect(html).toContain("账号凭据没有被修改");
    expect(html).not.toContain("oauth");
  });

  it("recognizes expected navigation aborts without matching unrelated errors", () => {
    expect(isNavigationAbortError(Object.assign(new Error("aborted"), { code: "ERR_ABORTED" }))).toBe(true);
    expect(isNavigationAbortError(new Error("ERR_ABORTED (-3) loading fallback"))).toBe(true);
    expect(isNavigationAbortError(Object.assign(new Error("failed"), { code: "ERR_FAILED" }))).toBe(false);
  });

  it("ignores aborted and subframe load failures", async () => {
    const renderFallback = vi.fn();
    const controller = createRendererFailureController(makeOptions({ renderFallback }));

    await expect(controller.handleLoadFailure({ errorCode: -3, isMainFrame: true })).resolves.toBe(false);
    await expect(controller.handleLoadFailure({ errorCode: -105, isMainFrame: false })).resolves.toBe(false);

    expect(renderFallback).not.toHaveBeenCalled();
  });

  it("shows the fallback and reloads after a main-frame load failure", async () => {
    const events: string[] = [];
    const controller = createRendererFailureController(makeOptions({
      reportFailure: async () => events.push("report"),
      renderFallback: async () => events.push("fallback"),
      showRecoveryPrompt: async () => {
        events.push("prompt");
        return "retry";
      },
      reloadRenderer: async () => events.push("reload")
    }));

    await expect(controller.handleLoadFailure({ errorCode: -105, isMainFrame: true })).resolves.toBe(true);

    expect(events).toEqual(["report", "fallback", "prompt", "reload"]);
  });

  it("opens the diagnostics directory after a renderer crash when requested", async () => {
    const openDiagnosticsDirectory = vi.fn().mockResolvedValue(undefined);
    const controller = createRendererFailureController(makeOptions({
      showRecoveryPrompt: async () => "open_diagnostics",
      openDiagnosticsDirectory
    }));

    await expect(controller.handleRenderProcessGone({
      reason: "crashed",
      exitCode: 9,
      isQuitting: false
    })).resolves.toBe(true);

    expect(openDiagnosticsDirectory).toHaveBeenCalledTimes(1);
  });

  it("ignores clean renderer exits while the application is quitting", async () => {
    const renderFallback = vi.fn();
    const controller = createRendererFailureController(makeOptions({ renderFallback }));

    await expect(controller.handleRenderProcessGone({
      reason: "clean-exit",
      exitCode: 0,
      isQuitting: true
    })).resolves.toBe(false);

    expect(renderFallback).not.toHaveBeenCalled();
  });

  it("keeps recovery usable when diagnostics or fallback callbacks throw synchronously", async () => {
    const controller = createRendererFailureController(makeOptions({
      reportFailure: () => {
        throw new Error("logger unavailable");
      },
      renderFallback: () => {
        throw new Error("fallback unavailable");
      },
      showRecoveryPrompt: async () => "retry",
      reloadRenderer: () => {
        throw new Error("reload unavailable");
      }
    }));

    await expect(controller.handleLoadFailure({ errorCode: -105, isMainFrame: true })).resolves.toBe(true);
  });
});

function makeOptions(overrides: Partial<Parameters<typeof createRendererFailureController>[0]> = {}) {
  return {
    reportFailure: async () => undefined,
    renderFallback: async () => undefined,
    showRecoveryPrompt: async () => "exit" as const,
    reloadRenderer: async () => undefined,
    openDiagnosticsDirectory: async () => undefined,
    quit: () => undefined,
    ...overrides
  };
}

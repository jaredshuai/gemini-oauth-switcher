import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RendererErrorBoundary, RendererFailureFallback } from "../src/renderer/components/RendererErrorBoundary";

describe("RendererErrorBoundary", () => {
  it("switches to a generic failure state without retaining the thrown error", () => {
    const state = RendererErrorBoundary.getDerivedStateFromError(new Error("oauth-secret-must-not-render"));

    expect(state).toEqual({ hasError: true });
    expect(state).not.toHaveProperty("error");
  });

  it("renders a reload action without exposing raw exception text", () => {
    const html = renderToStaticMarkup(
      <RendererFailureFallback onReload={() => undefined} />
    );

    expect(html).toContain("界面加载出现问题");
    expect(html).toContain("重新加载界面");
    expect(html).toContain("账号凭据没有被修改");
    expect(html).not.toContain("oauth-secret-must-not-render");
  });
});

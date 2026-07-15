import { RefreshCw, TriangleAlert } from "lucide-react";
import React, { Component, type ReactNode } from "react";

interface RendererErrorBoundaryProps {
  children: ReactNode;
}

interface RendererErrorBoundaryState {
  hasError: boolean;
}

export class RendererErrorBoundary extends Component<RendererErrorBoundaryProps, RendererErrorBoundaryState> {
  state: RendererErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(_error: unknown): RendererErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    void window.geminiSwitcher?.reportRendererFailure().catch(() => undefined);
  }

  render() {
    if (this.state.hasError) {
      return <RendererFailureFallback onReload={() => window.location.reload()} />;
    }

    return this.props.children;
  }
}

export function RendererFailureFallback({ onReload }: { onReload: () => void }) {
  return (
    <main className="app-parchment flex min-h-screen items-center justify-center px-6 text-neutral-950 antialiased">
      <section className="credential-console w-full max-w-xl overflow-hidden rounded-md bg-neutral-950 px-8 py-9 text-neutral-100 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-amber-300/30 bg-amber-300/10 text-amber-200">
            <TriangleAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-white">界面加载出现问题</h1>
            <p className="mt-2 text-sm leading-6 text-neutral-300">
              账号凭据没有被修改。请重新加载界面；如果问题仍然存在，请关闭应用后重新打开。
            </p>
            <button className="console-action-button mt-5" type="button" onClick={onReload}>
              <RefreshCw className="h-4 w-4" />
              重新加载界面
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

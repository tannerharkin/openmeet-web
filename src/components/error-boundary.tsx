import { Component, type ReactNode } from "react";
import { useStore } from "@/store";

// A render error would otherwise leave a blank page; show a plain way out instead.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: unknown) {
    useStore.getState().logError(`Page error: ${error instanceof Error ? error.message : String(error)}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-3xl space-y-3 p-6">
        <p className="font-medium">Something went wrong on this page.</p>
        <p className="text-sm text-muted-foreground">Reload to start again; the dongle reconnects after the reload.</p>
        <button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

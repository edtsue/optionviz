"use client";
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Best-effort log to the server. Never throw from the boundary itself.
    try {
      void fetch("/api/log-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack ?? null,
          componentStack: info.componentStack ?? null,
          url: typeof window !== "undefined" ? window.location.href : null,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        }),
      });
    } catch {
      // swallow — logging is opportunistic
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      return (
        <div className="p-6">
          <div className="card mx-auto max-w-md text-center">
            <h2 className="text-base font-semibold">Something broke.</h2>
            <p className="mt-2 text-sm muted">
              {this.state.error.message || "An unexpected error occurred."}
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                onClick={this.reset}
                className="btn-ghost rounded-lg px-3 py-1.5 text-sm"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="btn-primary rounded-lg px-3 py-1.5 text-sm"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

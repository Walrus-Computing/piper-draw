import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors from children (e.g. a Three.js crash inside <Canvas>)
 * and shows a fallback UI instead of unmounting the whole app. Async errors
 * and event-handler errors are not caught — those still surface to the console.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#CBDFC6",
            color: "#333",
            fontFamily: "sans-serif",
            padding: 24,
          }}
        >
          <div style={{ maxWidth: 520, textAlign: "center" }}>
            <h2 style={{ margin: "0 0 12px" }}>Something went wrong.</h2>
            <pre
              style={{
                textAlign: "left",
                fontSize: 12,
                background: "rgba(0,0,0,0.06)",
                padding: 12,
                borderRadius: 6,
                overflow: "auto",
                maxHeight: 240,
              }}
            >
              {this.state.error.message}
            </pre>
            <button
              onClick={this.reset}
              style={{
                marginTop: 12,
                padding: "8px 16px",
                border: "1px solid #999",
                borderRadius: 6,
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

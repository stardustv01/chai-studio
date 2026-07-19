import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Notice } from "@chai-studio/ui-components";

interface ErrorBoundaryProps {
  readonly area: string;
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Studio panel isolated an error", {
      area: this.props.area,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="panel-error" role="alert">
        <Notice
          tone="danger"
          title={`${this.props.area} could not load`}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                this.setState({ error: null });
              }}
            >
              Retry panel
            </Button>
          }
        >
          The rest of the editor is safe. {this.state.error.message}
        </Notice>
      </div>
    );
  }
}

"use client";

import { Component, type ReactNode } from "react";
import { ErrorState } from "./error-state";

type State = { error: unknown; failed: boolean };

/** Convex hooks throw query errors during render; this keeps one failing section from blanking the page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null, failed: false })} />;
    }
    return this.props.children;
  }
}

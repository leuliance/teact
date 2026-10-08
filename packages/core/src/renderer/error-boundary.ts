import React from 'react';
import type { ReactNode, ErrorInfo } from 'react';

export interface ErrorBoundaryProps {
  fallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
  children?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return (this.props.fallback as (error: Error, retry: () => void) => ReactNode)(
          this.state.error,
          this.retry,
        );
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Don't show the raw error to end users: messages can carry internals (SQL, paths,
      // tokens). It is logged via onError; pass `fallback` to customize this screen.
      return React.createElement('tg-message', {
        text: '❌ Something went wrong. Please try again, or use /start to restart.',
      });
    }

    return this.props.children;
  }
}

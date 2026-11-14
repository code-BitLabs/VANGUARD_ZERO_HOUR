import React from 'react';
import { Button } from './Button';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : 'Unexpected tactical UI exception.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 bg-[#0B0E11] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#141920] border border-red-500/60 p-6 rounded-sm text-zinc-100">
            <p className="font-mono text-xs uppercase tracking-widest text-red-400">System Recovery</p>
            <h2 className="font-display text-2xl font-bold uppercase mt-1">Interface Fault Detected</h2>
            <p className="text-sm text-zinc-400 mt-2">{this.state.message}</p>
            <div className="mt-5 flex gap-3">
              <Button onClick={() => this.setState({ hasError: false, message: '' })}>
                Reset Interface
              </Button>
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Reload Applet
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

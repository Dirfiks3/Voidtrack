import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportCrash } from "../lib/errorLog";
import CrashScreen from "./CrashScreen";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportCrash(error, `react:${info.componentStack?.split("\n")[1]?.trim() || "render"}`);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <CrashScreen onDismiss={() => this.setState({ failed: false })} />;
    }
    return this.props.children;
  }
}

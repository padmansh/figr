import { Component, type ReactNode } from "react";
import type { Region } from "./Region";

interface Props {
  region: Region;
  /** The region is failed for any reason (render, handler, async); comes from the store. */
  failed: boolean;
  fallback: ReactNode;
  children: ReactNode;
}

/** Catches render errors and hands them to the region; shows the fallback while the region is failed. */
export class RegionBoundary extends Component<Props, { caught: boolean }> {
  state = { caught: false };

  static getDerivedStateFromError() {
    return { caught: true };
  }

  componentDidCatch(error: unknown) {
    this.props.region.fail(error);
  }

  componentDidUpdate(prev: Props) {
    // Retry cleared the region: render the children again.
    if (prev.failed && !this.props.failed && this.state.caught) this.setState({ caught: false });
  }

  render() {
    return this.state.caught || this.props.failed ? this.props.fallback : this.props.children;
  }
}

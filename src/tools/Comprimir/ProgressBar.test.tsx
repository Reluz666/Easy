import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressBar from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders the current percentage as text", () => {
    render(<ProgressBar pct={42} />);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
  });

  it("clamps pct to [0, 100]", () => {
    render(<ProgressBar pct={150} />);
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuenow", "100");
  });

  it("renders 0% when pct is negative", () => {
    render(<ProgressBar pct={-5} />);
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });

  it("has role=progressbar and aria-valuemin/max", () => {
    render(<ProgressBar pct={50} />);
    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "100");
    expect(progress).toHaveAttribute("aria-valuenow", "50");
  });
});
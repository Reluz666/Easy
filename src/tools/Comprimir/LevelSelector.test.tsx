import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LevelSelector from "./LevelSelector";

describe("LevelSelector", () => {
  const levels = [
    { id: "baja", label: "Baja", description: "Casi sin pérdida visible" },
    { id: "media", label: "Media", description: "Balance recomendado" },
    { id: "alta", label: "Alta", description: "Máxima reducción" },
  ] as const;

  it("renders one button per level with label and description", () => {
    render(<LevelSelector levels={levels} value={null} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /Baja/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Media/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Alta/i })).toBeInTheDocument();
  });

  it("marks the active level with aria-checked=true", () => {
    render(<LevelSelector levels={levels} value="media" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /Media/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Baja/i })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with the clicked level id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LevelSelector levels={levels} value={null} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: /Alta/i }));
    expect(onChange).toHaveBeenCalledWith("alta");
  });

  it("disables all buttons when disabled=true", () => {
    render(<LevelSelector levels={levels} value={null} onChange={() => {}} disabled />);
    expect(screen.getByRole("radio", { name: /Baja/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Media/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Alta/i })).toBeDisabled();
  });
});
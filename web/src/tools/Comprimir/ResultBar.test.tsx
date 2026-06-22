import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResultBar from "./ResultBar";

describe("ResultBar", () => {
  // Values chosen so binary MB formatting produces "8.4 MB" / "3.7 MB"
  // and the reduction rounds to 56% (matches spec intent).
  const originalBytes = 8_800_000;
  const resultBytes = 3_880_000;

  it("shows original size, result size, and percentage reduction", () => {
    render(
      <ResultBar
        originalBytes={originalBytes}
        resultBytes={resultBytes}
        onDownload={() => {}}
      />,
    );
    expect(screen.getByText(/Original/i)).toHaveTextContent(/8\.4 MB/);
    expect(screen.getByText(/Resultado/i)).toHaveTextContent(/3\.7 MB/);
    expect(screen.getByText(/-56%/)).toBeInTheDocument();
  });

  it("calls onDownload when the button is clicked", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(
      <ResultBar
        originalBytes={originalBytes}
        resultBytes={resultBytes}
        onDownload={onDownload}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Descargar/i }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("disables the button when disabled is true", () => {
    render(
      <ResultBar
        originalBytes={originalBytes}
        resultBytes={resultBytes}
        onDownload={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: /Descargar/i })).toBeDisabled();
  });
});

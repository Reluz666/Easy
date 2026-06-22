import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import ComprimirPage from "./ComprimirPage";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// Mock the API client so these tests stay hermetic — they exercise the
// React rendering + state machine, not the network.
vi.mock("../../lib/api/jobs", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api/jobs")>(
    "../../lib/api/jobs",
  );
  return {
    ...actual,
    createCompressJob: vi.fn(),
    createOcrJob: vi.fn(),
    getJob: vi.fn(),
    downloadJobResult: vi.fn(),
    deleteJob: vi.fn(),
  };
});

import {
  createCompressJob,
  createOcrJob,
  getJob,
  type JobInfo,
} from "../../lib/api/jobs";

const SAMPLE_PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
]);

function makePdfFile(name = "sample.pdf"): File {
  return new File([SAMPLE_PDF_BYTES], name, { type: "application/pdf" });
}

function findFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) throw new Error("file input not found");
  return input;
}

async function uploadFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  // The UploadArea uses a hidden <input type="file"> with no label, so we
  // pick it up via querySelector and feed the file in directly.
  await user.upload(findFileInput(), file);
}

beforeEach(() => {
  vi.mocked(createCompressJob).mockReset();
  vi.mocked(createOcrJob).mockReset();
  vi.mocked(getJob).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ComprimirPage mode toggle", () => {
  it("renders both mode options at the top of the page", () => {
    renderWithRouter(<ComprimirPage />);
    expect(
      screen.getByText(/PDF escaneado: OCR \+ optimización/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/^PDF normal$/i)).toBeInTheDocument();
  });

  it("compress mode shows the level selector after a file is uploaded", async () => {
    const user = userEvent.setup();
    renderWithRouter(<ComprimirPage />);
    await user.upload(findFileInput(), makePdfFile());

    // Three compression radios must be present in compress mode.
    expect(screen.getByRole("radio", { name: /Baja/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Media/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Alta/i })).toBeInTheDocument();
  });

  it("OCR mode hides the level selector and shows the OCR info + signature warning", async () => {
    const user = userEvent.setup();
    renderWithRouter(<ComprimirPage />);
    await uploadFile(user, makePdfFile());

    // Switch to OCR.
    await user.click(screen.getByTestId("mode-ocr"));

    // Level selector gone.
    expect(screen.queryByRole("radio", { name: /Baja/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Media/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Alta/i })).not.toBeInTheDocument();

    // OCR notes present.
    expect(screen.getByTestId("ocr-info-note")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-signature-warning")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-signature-warning").textContent).toMatch(
      /firma digital/i,
    );
  });

  it("OCR mode disables submit until a file is loaded", () => {
    renderWithRouter(<ComprimirPage />);
    // Switch to OCR *before* uploading anything.
    act(() => {
      // Simulate clicking the OCR radio.
      const radio = screen.getByTestId("mode-ocr") as HTMLInputElement;
      radio.click();
    });
    // No file yet => no submit button rendered (file is the gate).
    expect(screen.queryByTestId("submit-button")).not.toBeInTheDocument();
  });

  it("OCR submission calls createOcrJob with spa+eng and the file", async () => {
    const user = userEvent.setup();
    vi.mocked(createOcrJob).mockResolvedValue("job-123");
    // `getJob` returns "done" immediately so the page resolves to the
    // success state without entering the poll loop.
    const doneInfo: JobInfo = {
      id: "job-123",
      op: "ocr",
      status: "done",
      progress: 100,
      params: { lang: "spa+eng", safe_name: "sample.pdf" },
      input_path: "/tmp/job-123/input.pdf",
      output_path: "/tmp/job-123/output.pdf",
      error_code: null,
      error_message: null,
      input_bytes: SAMPLE_PDF_BYTES.byteLength,
      output_bytes: SAMPLE_PDF_BYTES.byteLength,
      reduction_pct: 0,
      duration_ms: 100,
      created_at: "2026-06-22T11:00:00.000Z",
      started_at: "2026-06-22T11:00:01.000Z",
      finished_at: "2026-06-22T11:00:02.000Z",
    };
    vi.mocked(getJob).mockResolvedValue(doneInfo);

    renderWithRouter(<ComprimirPage />);
    await uploadFile(user, makePdfFile("scan.pdf"));
    await user.click(screen.getByTestId("mode-ocr"));

    // Submit.
    const submit = await screen.findByTestId("submit-button");
    await user.click(submit);

    await waitFor(() => expect(createOcrJob).toHaveBeenCalledTimes(1));
    const [fileArg, langArg] = vi.mocked(createOcrJob).mock.calls[0];
    expect(fileArg).toBeInstanceOf(File);
    expect(fileArg.name).toBe("scan.pdf");
    expect(langArg).toBe("spa+eng");
  });

  it("shows a 'PDF creció un X%' note when OCR grows the file", async () => {
    const user = userEvent.setup();
    vi.mocked(createOcrJob).mockResolvedValue("job-grow");
    const grewInfo: JobInfo = {
      id: "job-grow",
      op: "ocr",
      status: "done",
      progress: 100,
      params: { lang: "spa+eng", safe_name: "scan.pdf" },
      input_path: "/tmp/job-grow/input.pdf",
      output_path: "/tmp/job-grow/output.pdf",
      error_code: null,
      error_message: null,
      input_bytes: 1_000_000,
      output_bytes: 1_029_000,
      reduction_pct: -2.9, // grew
      duration_ms: 459_000,
      created_at: "2026-06-22T11:00:00.000Z",
      started_at: "2026-06-22T11:00:01.000Z",
      finished_at: "2026-06-22T11:07:40.000Z",
    };
    vi.mocked(getJob).mockResolvedValue(grewInfo);

    renderWithRouter(<ComprimirPage />);
    await uploadFile(user, makePdfFile("scan.pdf"));
    await user.click(screen.getByTestId("mode-ocr"));
    await user.click(await screen.findByTestId("submit-button"));

    const note = await screen.findByTestId("ocr-grew-note");
    expect(note.textContent).toMatch(/creci[oó]\s+un\s+2\.9%/i);
  });
});

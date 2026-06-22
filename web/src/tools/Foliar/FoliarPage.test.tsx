import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import FoliarPage from "./FoliarPage";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// Hermetic — exercise the React state machine, not the network.
vi.mock("../../lib/api/jobs", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api/jobs")>(
    "../../lib/api/jobs",
  );
  return {
    ...actual,
    createFoliateJob: vi.fn(),
    getJob: vi.fn(),
    downloadJobResult: vi.fn(),
    deleteJob: vi.fn(),
  };
});

import {
  createFoliateJob,
  getJob,
  type JobInfo,
} from "../../lib/api/jobs";

const SAMPLE_PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
]);

function makePdfFile(name = "doc.pdf"): File {
  return new File([SAMPLE_PDF_BYTES], name, { type: "application/pdf" });
}

function findFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) throw new Error("file input not found");
  return input;
}

async function uploadFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(findFileInput(), file);
}

function makeJobInfo(overrides: Partial<JobInfo> = {}): JobInfo {
  return {
    id: "job-1",
    op: "foliate",
    status: "done",
    progress: 100,
    params: {
      initial_number: 1,
      prefix: "",
      position: "bottom-center",
      font_size: 12,
      range_mode: "all",
      from_page: null,
      to_page: null,
      safe_name: "doc.pdf",
    },
    input_path: "/tmp/job-1/input.pdf",
    output_path: "/tmp/job-1/output.pdf",
    error_code: null,
    error_message: null,
    input_bytes: SAMPLE_PDF_BYTES.byteLength,
    output_bytes: SAMPLE_PDF_BYTES.byteLength + 50,
    reduction_pct: -2.0,
    duration_ms: 200,
    created_at: "2026-06-22T11:00:00.000Z",
    started_at: "2026-06-22T11:00:01.000Z",
    finished_at: "2026-06-22T11:00:02.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(createFoliateJob).mockReset();
  vi.mocked(getJob).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("FoliarPage default UI", () => {
  it("renders the title and upload area before a file is selected", () => {
    renderWithRouter(<FoliarPage />);
    expect(screen.getByRole("heading", { name: /Foliar/i })).toBeInTheDocument();
    expect(findFileInput()).toBeInTheDocument();
    expect(screen.queryByTestId("submit-button")).not.toBeInTheDocument();
  });

  it("renders all six positions after a file is uploaded", async () => {
    const user = userEvent.setup();
    renderWithRouter(<FoliarPage />);
    await uploadFile(user, makePdfFile());

    expect(screen.getByTestId("foliar-position-top-left")).toBeInTheDocument();
    expect(screen.getByTestId("foliar-position-top-center")).toBeInTheDocument();
    expect(screen.getByTestId("foliar-position-top-right")).toBeInTheDocument();
    expect(screen.getByTestId("foliar-position-bottom-left")).toBeInTheDocument();
    expect(screen.getByTestId("foliar-position-bottom-center")).toBeInTheDocument();
    expect(screen.getByTestId("foliar-position-bottom-right")).toBeInTheDocument();
  });

  it("renders prefix, initial number, font size and range mode inputs", async () => {
    const user = userEvent.setup();
    renderWithRouter(<FoliarPage />);
    await uploadFile(user, makePdfFile());

    expect(screen.getByTestId("foliar-prefix")).toBeInTheDocument();
    expect(screen.getByTestId("foliar-initial-number")).toBeInTheDocument();
    expect(screen.getByTestId("foliar-font-size")).toBeInTheDocument();
    expect(screen.getByTestId("foliar-range-all")).toBeInTheDocument();
    expect(screen.getByTestId("foliar-range-from-to")).toBeInTheDocument();
  });

  it("'from-to' range reveals from/to inputs with null defaults", async () => {
    const user = userEvent.setup();
    renderWithRouter(<FoliarPage />);
    await uploadFile(user, makePdfFile());

    await user.click(screen.getByTestId("foliar-range-from-to"));
    expect(screen.getByTestId("foliar-from")).toBeInTheDocument();
    expect(screen.getByTestId("foliar-to")).toBeInTheDocument();
  });
});

describe("FoliarPage submission", () => {
  it("calls createFoliateJob with the file and minimal defaults", async () => {
    const user = userEvent.setup();
    vi.mocked(createFoliateJob).mockResolvedValue("job-1");
    vi.mocked(getJob).mockResolvedValue(makeJobInfo());

    renderWithRouter(<FoliarPage />);
    await uploadFile(user, makePdfFile("scan.pdf"));
    await user.click(await screen.findByTestId("submit-button"));

    await waitFor(() => expect(createFoliateJob).toHaveBeenCalledTimes(1));
    const [fileArg, paramsArg] = vi.mocked(createFoliateJob).mock.calls[0];
    expect(fileArg).toBeInstanceOf(File);
    expect(fileArg.name).toBe("scan.pdf");
    expect(paramsArg).toEqual({
      initial_number: 1,
      prefix: "",
      position: "bottom-center",
      font_size: 12,
      range_mode: "all",
      from_page: null,
      to_page: null,
    });
  });

  it("passes prefix, initial_number, font_size, position and from-to range", async () => {
    const user = userEvent.setup();
    vi.mocked(createFoliateJob).mockResolvedValue("job-1");
    vi.mocked(getJob).mockResolvedValue(makeJobInfo());

    renderWithRouter(<FoliarPage />);
    await uploadFile(user, makePdfFile());

    await user.click(screen.getByTestId("foliar-position-top-right"));
    await user.clear(screen.getByTestId("foliar-prefix"));
    await user.type(screen.getByTestId("foliar-prefix"), "Folio ");
    await user.clear(screen.getByTestId("foliar-initial-number"));
    await user.type(screen.getByTestId("foliar-initial-number"), "10");
    await user.clear(screen.getByTestId("foliar-font-size"));
    await user.type(screen.getByTestId("foliar-font-size"), "16");

    await user.click(screen.getByTestId("foliar-range-from-to"));
    await user.type(screen.getByTestId("foliar-from"), "2");
    await user.type(screen.getByTestId("foliar-to"), "5");

    await user.click(await screen.findByTestId("submit-button"));

    await waitFor(() => expect(createFoliateJob).toHaveBeenCalledTimes(1));
    const paramsArg = vi.mocked(createFoliateJob).mock.calls[0][1];
    expect(paramsArg).toMatchObject({
      initial_number: 10,
      prefix: "Folio ",
      position: "top-right",
      font_size: 16,
      range_mode: "from-to",
      from_page: 2,
      to_page: 5,
    });
  });

  it("shows the result bar with sizes after status=done", async () => {
    const user = userEvent.setup();
    vi.mocked(createFoliateJob).mockResolvedValue("job-1");
    vi.mocked(getJob).mockResolvedValue(
      makeJobInfo({
        input_bytes: 100_000,
        output_bytes: 110_000,
        reduction_pct: -10.0,
      }),
    );

    renderWithRouter(<FoliarPage />);
    await uploadFile(user, makePdfFile("big.pdf"));
    await user.click(await screen.findByTestId("submit-button"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Descargar PDF/i })).toBeInTheDocument(),
    );
  });

  it("shows the Spanish backend error message on status=failed", async () => {
    const user = userEvent.setup();
    vi.mocked(createFoliateJob).mockResolvedValue("job-bad");
    vi.mocked(getJob).mockResolvedValue(
      makeJobInfo({
        id: "job-bad",
        status: "failed",
        progress: 0,
        output_path: null,
        output_bytes: null,
        error_code: "INVALID_PAGE_RANGE",
        error_message: "El rango de páginas no es válido.",
      }),
    );

    renderWithRouter(<FoliarPage />);
    await uploadFile(user, makePdfFile("scan.pdf"));
    await user.click(await screen.findByTestId("submit-button"));

    const alert = await screen.findByTestId("foliar-error");
    expect(alert.textContent).toMatch(/El rango de páginas no es válido/);
  });

  it("shows INVALID_PAGE_RANGE for an out-of-bounds range that the backend detected", async () => {
    const user = userEvent.setup();
    vi.mocked(createFoliateJob).mockResolvedValue("job-oob");
    vi.mocked(getJob).mockResolvedValue(
      makeJobInfo({
        id: "job-oob",
        status: "failed",
        error_code: "FOLIATE_FAILED",
        error_message: "No se pudo foliar el PDF.",
      }),
    );

    renderWithRouter(<FoliarPage />);
    await uploadFile(user, makePdfFile("scan.pdf"));
    await user.click(await screen.findByTestId("submit-button"));

    const alert = await screen.findByTestId("foliar-error");
    expect(alert.textContent).toMatch(/No se pudo foliar el PDF/);
  });
});

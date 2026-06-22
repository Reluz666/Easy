import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import PaginasPage from "./PaginasPage";

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
    createPagesJob: vi.fn(),
    getJob: vi.fn(),
    downloadJobResult: vi.fn(),
    deleteJob: vi.fn(),
  };
});

import {
  createPagesJob,
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
  // The first file input is the upload-area input; the secondary extra-file
  // input gets its own data-testid (`paginas-extra-file`).
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
    op: "pages",
    status: "done",
    progress: 100,
    params: {
      safe_name: "doc.pdf",
      has_extra: false,
      extra_path: null,
      ops: [],
    },
    input_path: "/tmp/job-1/input.pdf",
    output_path: "/tmp/job-1/output.pdf",
    error_code: null,
    error_message: null,
    input_bytes: SAMPLE_PDF_BYTES.byteLength,
    output_bytes: SAMPLE_PDF_BYTES.byteLength,
    reduction_pct: 0,
    duration_ms: 200,
    created_at: "2026-06-22T11:00:00.000Z",
    started_at: "2026-06-22T11:00:01.000Z",
    finished_at: "2026-06-22T11:00:02.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(createPagesJob).mockReset();
  vi.mocked(getJob).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Default UI
// ---------------------------------------------------------------------------
describe("PaginasPage default UI", () => {
  it("renders the title and upload area before a file is selected", () => {
    renderWithRouter(<PaginasPage />);
    expect(screen.getByRole("heading", { name: /Páginas/i })).toBeInTheDocument();
    expect(findFileInput()).toBeInTheDocument();
    expect(screen.queryByTestId("paginas-submit")).not.toBeInTheDocument();
  });

  it("renders the four operation add-buttons after a file is uploaded", async () => {
    const user = userEvent.setup();
    renderWithRouter(<PaginasPage />);
    await uploadFile(user, makePdfFile());

    expect(screen.getByTestId("paginas-add-delete")).toBeInTheDocument();
    expect(screen.getByTestId("paginas-add-insert")).toBeInTheDocument();
    expect(screen.getByTestId("paginas-add-rotate")).toBeInTheDocument();
    expect(screen.getByTestId("paginas-add-reorder")).toBeInTheDocument();
  });

  it("disables submit until at least one op is added", async () => {
    const user = userEvent.setup();
    renderWithRouter(<PaginasPage />);
    await uploadFile(user, makePdfFile());

    expect(screen.getByTestId("paginas-submit")).toBeDisabled();

    await user.click(screen.getByTestId("paginas-add-delete"));
    expect(screen.getByTestId("paginas-submit")).toBeEnabled();
  });

  it("removes an op when its Quitar button is clicked", async () => {
    const user = userEvent.setup();
    renderWithRouter(<PaginasPage />);
    await uploadFile(user, makePdfFile());

    await user.click(screen.getByTestId("paginas-add-delete"));
    await user.click(screen.getByTestId("paginas-add-rotate"));
    expect(screen.getAllByTestId(/^paginas-op-\d+$/).length).toBe(2);

    await user.click(screen.getByTestId("paginas-op-0-remove"));
    expect(screen.getAllByTestId(/^paginas-op-\d+$/).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------
describe("PaginasPage submission", () => {
  it("compiles a delete op and calls createPagesJob with the right shape", async () => {
    const user = userEvent.setup();
    vi.mocked(createPagesJob).mockResolvedValue("job-1");
    vi.mocked(getJob).mockResolvedValue(makeJobInfo());

    renderWithRouter(<PaginasPage />);
    await uploadFile(user, makePdfFile("scan.pdf"));
    await user.click(screen.getByTestId("paginas-add-delete"));
    await user.type(screen.getByTestId("paginas-op-0-pages"), "2,5-7");
    await user.click(screen.getByTestId("paginas-submit"));

    await waitFor(() => expect(createPagesJob).toHaveBeenCalledTimes(1));
    const [fileArg, opsArg, extraArg] = vi.mocked(createPagesJob).mock.calls[0];
    expect(fileArg).toBeInstanceOf(File);
    expect(fileArg.name).toBe("scan.pdf");
    expect(opsArg).toEqual([{ op: "delete", pages: [2, 5, 6, 7] }]);
    // No extra file required for delete-only flow.
    expect(extraArg).toBeFalsy();
  });

  it("compiles rotate + reorder ops in order with the right parameters", async () => {
    const user = userEvent.setup();
    vi.mocked(createPagesJob).mockResolvedValue("job-1");
    vi.mocked(getJob).mockResolvedValue(makeJobInfo());

    renderWithRouter(<PaginasPage />);
    await uploadFile(user, makePdfFile());

    await user.click(screen.getByTestId("paginas-add-rotate"));
    await user.type(screen.getByTestId("paginas-op-0-pages"), "1-2");
    await user.click(screen.getByTestId("paginas-op-0-degrees-180"));

    await user.click(screen.getByTestId("paginas-add-reorder"));
    await user.type(screen.getByTestId("paginas-op-1-order"), "3,1,2");

    await user.click(screen.getByTestId("paginas-submit"));

    await waitFor(() => expect(createPagesJob).toHaveBeenCalledTimes(1));
    const opsArg = vi.mocked(createPagesJob).mock.calls[0][1];
    expect(opsArg).toEqual([
      { op: "rotate", pages: [1, 2], degrees: 180 },
      { op: "reorder", order: [3, 1, 2] },
    ]);
  });

  it("blocks submit and shows an inline error when an op's pages are invalid", async () => {
    const user = userEvent.setup();
    vi.mocked(createPagesJob).mockResolvedValue("job-1");
    vi.mocked(getJob).mockResolvedValue(makeJobInfo());

    renderWithRouter(<PaginasPage />);
    await uploadFile(user, makePdfFile());
    await user.click(screen.getByTestId("paginas-add-delete"));
    await user.type(screen.getByTestId("paginas-op-0-pages"), "foo");
    await user.click(screen.getByTestId("paginas-submit"));

    expect(createPagesJob).not.toHaveBeenCalled();
    const err = await screen.findByTestId("paginas-error");
    expect(err.textContent).toMatch(/Operación 1 \(eliminar\)/);
  });

  it("requires an extra_file when an insert op reads from 'extra'", async () => {
    const user = userEvent.setup();
    vi.mocked(createPagesJob).mockResolvedValue("job-1");
    vi.mocked(getJob).mockResolvedValue(makeJobInfo());

    renderWithRouter(<PaginasPage />);
    await uploadFile(user, makePdfFile());

    await user.click(screen.getByTestId("paginas-add-insert"));
    await user.click(screen.getByTestId("paginas-op-0-source-extra"));
    await user.type(screen.getByTestId("paginas-op-0-pages"), "1");

    // Submitting without an extra_file should be blocked client-side.
    await user.click(screen.getByTestId("paginas-submit"));
    expect(createPagesJob).not.toHaveBeenCalled();
    const err = await screen.findByTestId("paginas-error");
    expect(err.textContent).toMatch(/PDF adicional/);
  });

  it("uploads the extra_file when the insert op asks for it", async () => {
    const user = userEvent.setup();
    vi.mocked(createPagesJob).mockResolvedValue("job-1");
    vi.mocked(getJob).mockResolvedValue(makeJobInfo());

    renderWithRouter(<PaginasPage />);
    await uploadFile(user, makePdfFile("main.pdf"));

    await user.click(screen.getByTestId("paginas-add-insert"));
    await user.click(screen.getByTestId("paginas-op-0-source-extra"));
    await user.type(screen.getByTestId("paginas-op-0-pages"), "2");

    // Now the extra-file input should appear; upload to it.
    const extraInput = (await screen.findByTestId("paginas-extra-file")) as HTMLInputElement;
    await user.upload(extraInput, makePdfFile("extra.pdf"));

    await user.click(screen.getByTestId("paginas-submit"));

    await waitFor(() => expect(createPagesJob).toHaveBeenCalledTimes(1));
    const [fileArg, opsArg, extraArg] = vi.mocked(createPagesJob).mock.calls[0];
    expect(fileArg.name).toBe("main.pdf");
    expect((extraArg as File).name).toBe("extra.pdf");
    expect(opsArg).toEqual([
      { op: "insert", after_page: 0, from_pdf: "extra", pages: [2] },
    ]);
  });

  it("shows the download button after status=done", async () => {
    const user = userEvent.setup();
    vi.mocked(createPagesJob).mockResolvedValue("job-1");
    vi.mocked(getJob).mockResolvedValue(
      makeJobInfo({
        input_bytes: 100_000,
        output_bytes: 80_000,
      }),
    );

    renderWithRouter(<PaginasPage />);
    await uploadFile(user, makePdfFile());
    await user.click(screen.getByTestId("paginas-add-delete"));
    await user.type(screen.getByTestId("paginas-op-0-pages"), "2");
    await user.click(screen.getByTestId("paginas-submit"));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Descargar PDF editado/i }),
      ).toBeInTheDocument(),
    );
  });

  it("shows the Spanish backend error message on status=failed", async () => {
    const user = userEvent.setup();
    vi.mocked(createPagesJob).mockResolvedValue("job-bad");
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

    renderWithRouter(<PaginasPage />);
    await uploadFile(user, makePdfFile());
    await user.click(screen.getByTestId("paginas-add-delete"));
    await user.type(screen.getByTestId("paginas-op-0-pages"), "999");
    await user.click(screen.getByTestId("paginas-submit"));

    const alert = await screen.findByTestId("paginas-error");
    expect(alert.textContent).toMatch(/El rango de páginas no es válido/);
  });
});

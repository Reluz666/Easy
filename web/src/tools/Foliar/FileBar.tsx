type FileBarProps = {
  fileName: string;
  fileSize: number;
  pageCount: number;
  onChangeFile: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileBar({ fileName, fileSize, pageCount, onChangeFile }: FileBarProps) {
  return (
    <div
      role="region"
      aria-label="Archivo cargado"
      className="bg-surface border border-border rounded-lg p-4 flex items-center gap-4"
    >
      <div className="bg-bg w-10 h-10 rounded flex items-center justify-center text-xl flex-shrink-0" aria-hidden="true">
        📄
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-text text-sm truncate">{fileName}</div>
        <div className="text-text-muted text-xs mt-0.5">
          {formatBytes(fileSize)} · {pageCount} {pageCount === 1 ? "página" : "páginas"}
        </div>
      </div>
      <button
        type="button"
        onClick={onChangeFile}
        className="text-sm bg-surface border border-border text-text px-3 py-1.5 rounded hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
      >
        Cambiar archivo
      </button>
    </div>
  );
}

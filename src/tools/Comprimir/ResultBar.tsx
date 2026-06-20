import { formatBytes } from "../../lib/format";

type ResultBarProps = {
  originalBytes: number;
  resultBytes: number;
  onDownload: () => void;
  disabled?: boolean;
};

export default function ResultBar({
  originalBytes,
  resultBytes,
  onDownload,
  disabled = false,
}: ResultBarProps) {
  const reduction = Math.round(((originalBytes - resultBytes) / originalBytes) * 100);
  return (
    <div className="flex flex-col gap-3 p-4 bg-surface border border-border rounded-lg">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="text-text-muted">
          Original: <strong className="text-text">{formatBytes(originalBytes)}</strong>
        </span>
        <span className="text-text-muted" aria-hidden="true">→</span>
        <span className="text-text-muted">
          Resultado: <strong className="text-text">{formatBytes(resultBytes)}</strong>
        </span>
        <span className="font-semibold text-primary">({-reduction}%)</span>
      </div>
      <button
        type="button"
        onClick={onDownload}
        disabled={disabled}
        className="self-start px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Descargar PDF comprimido
      </button>
    </div>
  );
}

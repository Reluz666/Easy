type ProgressBarProps = {
  pct: number;
};

export default function ProgressBar({ pct }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="flex flex-col gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-2 w-full bg-border rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${clamped}%` }}
          data-testid="progress-fill"
        />
      </div>
      <p className="text-sm text-text-muted" aria-live="polite">
        Procesando… {clamped}%
      </p>
    </div>
  );
}
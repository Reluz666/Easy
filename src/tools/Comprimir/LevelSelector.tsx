type LevelId = string;

export type LevelDescriptor = {
  id: LevelId;
  label: string;
  description: string;
};

type LevelSelectorProps = {
  levels: readonly LevelDescriptor[];
  value: LevelId | null;
  onChange: (level: LevelId) => void;
  disabled?: boolean;
};

export default function LevelSelector({
  levels,
  value,
  onChange,
  disabled = false,
}: LevelSelectorProps) {
  return (
    <div role="radiogroup" aria-label="Nivel de compresión" className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {levels.map((level) => {
        const isActive = value === level.id;
        return (
          <button
            key={level.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onChange(level.id)}
            className={[
              "text-left p-4 rounded-lg border-2 transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-primary",
              isActive
                ? "border-primary bg-primary-light"
                : "border-border bg-surface hover:border-primary",
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            <div className="font-semibold text-text">{level.label}</div>
            <div className="text-sm text-text-muted mt-1">{level.description}</div>
          </button>
        );
      })}
    </div>
  );
}
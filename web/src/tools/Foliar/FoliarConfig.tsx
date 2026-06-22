import {
  FOLIO_POSITIONS,
  FOLIO_FONT_SIZE_MIN,
  FOLIO_FONT_SIZE_MAX,
  type FoliarConfig,
  type FolioPosition,
  type FolioRangeMode,
} from "../../lib/foliar/types";

type FoliarConfigProps = {
  config: FoliarConfig;
  totalPages: number | null;
  rangeError: string | null;
  onChange: (next: FoliarConfig) => void;
  disabled?: boolean;
};

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5"
    >
      {children}
    </label>
  );
}

export default function FoliarConfigPanel({
  config,
  totalPages,
  rangeError,
  onChange,
  disabled = false,
}: FoliarConfigProps) {
  function update<K extends keyof FoliarConfig>(key: K, value: FoliarConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  const initialInvalid = config.initial_number < 1;
  const sizeInvalid =
    config.font_size < FOLIO_FONT_SIZE_MIN || config.font_size > FOLIO_FONT_SIZE_MAX;
  const showRangeError = config.range_mode === "from-to" && rangeError !== null;

  return (
    <div className="space-y-5">
      {/* Position grid — 3 columns × 2 rows of top/bottom anchors */}
      <div>
        <Label>Posición</Label>
        <div
          role="radiogroup"
          aria-label="Posición del folio"
          className="grid grid-cols-3 gap-1 w-fit"
          data-testid="foliar-position-grid"
        >
          {FOLIO_POSITIONS.map((pos) => {
            const selected = config.position === pos;
            return (
              <button
                key={pos}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={pos}
                data-testid={`foliar-position-${pos}`}
                disabled={disabled}
                onClick={() => update("position", pos as FolioPosition)}
                className={`w-9 h-9 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${
                  selected
                    ? "bg-primary-light border-primary"
                    : "bg-surface border-border hover:border-primary"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Number prefix */}
      <div>
        <Label htmlFor="foliar-prefix">Prefijo (opcional)</Label>
        <input
          id="foliar-prefix"
          type="text"
          maxLength={32}
          placeholder="Ej: Folio "
          value={config.prefix}
          disabled={disabled}
          onChange={(e) => update("prefix", e.target.value)}
          data-testid="foliar-prefix"
          className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        />
        <p className="text-xs text-text-muted mt-1">
          Se antepone al número. Dejalo vacío si solo querés el número.
        </p>
      </div>

      {/* Initial number + Font size */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="foliar-initial">Número inicial</Label>
          <input
            id="foliar-initial"
            type="number"
            min={1}
            value={config.initial_number}
            disabled={disabled}
            onChange={(e) => update("initial_number", Number(e.target.value))}
            data-testid="foliar-initial-number"
            className={`w-full bg-surface border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${
              initialInvalid ? "border-red-500" : "border-border"
            }`}
          />
          {initialInvalid && (
            <p role="alert" className="text-xs text-red-600 mt-1">Debe ser ≥ 1.</p>
          )}
        </div>
        <div>
          <Label htmlFor="foliar-size">Tamaño (pt)</Label>
          <input
            id="foliar-size"
            type="number"
            min={FOLIO_FONT_SIZE_MIN}
            max={FOLIO_FONT_SIZE_MAX}
            value={config.font_size}
            disabled={disabled}
            onChange={(e) => update("font_size", Number(e.target.value))}
            data-testid="foliar-font-size"
            className={`w-full bg-surface border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${
              sizeInvalid ? "border-red-500" : "border-border"
            }`}
          />
          {sizeInvalid && (
            <p role="alert" className="text-xs text-red-600 mt-1">
              Entre {FOLIO_FONT_SIZE_MIN} y {FOLIO_FONT_SIZE_MAX} pt.
            </p>
          )}
        </div>
      </div>

      {/* Range mode */}
      <div>
        <Label>Páginas a foliar</Label>
        <div role="radiogroup" aria-label="Rango" className="flex gap-2">
          {([
            { value: "all", label: "Todas las páginas", testId: "foliar-range-all" },
            { value: "from-to", label: "Desde / hasta", testId: "foliar-range-from-to" },
          ] as const).map(({ value, label, testId }) => {
            const selected = config.range_mode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={testId}
                disabled={disabled}
                onClick={() => {
                  const next: FoliarConfig = { ...config, range_mode: value as FolioRangeMode };
                  if (value === "all") {
                    next.from_page = null;
                    next.to_page = null;
                  } else if (totalPages !== null) {
                    next.from_page = next.from_page ?? 1;
                    next.to_page = next.to_page ?? totalPages;
                  }
                  onChange(next);
                }}
                className={`flex-1 px-3 py-2 text-sm rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${
                  selected
                    ? "bg-primary-light border-primary text-primary"
                    : "bg-surface border-border text-text hover:border-primary"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {config.range_mode === "from-to" && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="foliar-from" className="block text-xs text-text-muted mb-1">
                Desde pág.
              </label>
              <input
                id="foliar-from"
                type="number"
                min={1}
                max={totalPages ?? undefined}
                value={config.from_page ?? ""}
                disabled={disabled}
                onChange={(e) => update("from_page", e.target.value === "" ? null : Number(e.target.value))}
                data-testid="foliar-from"
                className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="foliar-to" className="block text-xs text-text-muted mb-1">
                Hasta pág.
              </label>
              <input
                id="foliar-to"
                type="number"
                min={1}
                max={totalPages ?? undefined}
                value={config.to_page ?? ""}
                disabled={disabled}
                onChange={(e) => update("to_page", e.target.value === "" ? null : Number(e.target.value))}
                data-testid="foliar-to"
                className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
            </div>
          </div>
        )}

        {showRangeError && (
          <p role="alert" className="text-xs text-red-600 mt-2" data-testid="foliar-range-error">
            {rangeError}
          </p>
        )}
      </div>
    </div>
  );
}

import {
  FOLIO_POSITIONS,
  FOLIO_FORMAT_TEMPLATES,
  FOLIO_FONTS,
  FOLIO_FONT_SIZE_MIN,
  FOLIO_FONT_SIZE_MAX,
  type FoliarConfig,
  type FolioPosition,
  type FolioFormatTemplate,
  type FolioFont,
  type NumberStyle,
} from "../../lib/foliar/types";

type FoliarConfigProps = {
  config: FoliarConfig;
  totalPages: number;
  rangeError: string | null;
  onChange: (next: FoliarConfig) => void;
};

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
      {children}
    </label>
  );
}

export default function FoliarConfigPanel({ config, totalPages, rangeError, onChange }: FoliarConfigProps) {
  function update<K extends keyof FoliarConfig>(key: K, value: FoliarConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  function updateRange<K extends keyof FoliarConfig["range"]>(key: K, value: FoliarConfig["range"][K]) {
    onChange({ ...config, range: { ...config.range, [key]: value } });
  }

  const fromInvalid = config.range.from < 1 || config.range.from > totalPages;
  const toInvalid = config.range.to < config.range.from || config.range.to > totalPages;
  const initialInvalid = config.range.initialNumber < 1;
  const sizeInvalid = config.fontSize < FOLIO_FONT_SIZE_MIN || config.fontSize > FOLIO_FONT_SIZE_MAX;

  return (
    <div className="space-y-4">
      {/* Position matrix */}
      <div>
        <Label>Posición</Label>
        <div
          role="radiogroup"
          aria-label="Posición del folio"
          className="grid grid-cols-3 gap-1 w-fit"
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
                onClick={() => update("position", pos as FolioPosition)}
                className={`w-7 h-7 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                  selected
                    ? "bg-primary-light border-primary"
                    : "bg-surface border-border hover:border-primary"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Format */}
      <div>
        <Label htmlFor="foliar-format">Formato</Label>
        <select
          id="foliar-format"
          value={config.format}
          onChange={(e) => update("format", e.target.value as FolioFormatTemplate)}
          className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {FOLIO_FORMAT_TEMPLATES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Number style */}
      <div>
        <Label>Tipo de numeración</Label>
        <div role="radiogroup" aria-label="Tipo de numeración" className="flex gap-1.5">
          {(["numbers", "letters", "both", "words"] as NumberStyle[]).map((style) => {
            const label = style === "numbers" ? "Números" : style === "letters" ? "Letras" : style === "both" ? "Ambas" : "Palabras";
            const selected = config.numberStyle === style;
            return (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => update("numberStyle", style)}
                className={`flex-1 px-2 py-1.5 text-sm rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
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
      </div>

      {/* Font */}
      <div>
        <Label htmlFor="foliar-font">Tipo de letra</Label>
        <select
          id="foliar-font"
          value={config.font}
          onChange={(e) => update("font", e.target.value as FolioFont)}
          className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {FOLIO_FONTS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* Size + Color */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="foliar-size">Tamaño (pt)</Label>
          <input
            id="foliar-size"
            type="number"
            min={FOLIO_FONT_SIZE_MIN}
            max={FOLIO_FONT_SIZE_MAX}
            value={config.fontSize}
            onChange={(e) => update("fontSize", Number(e.target.value))}
            className={`w-full bg-surface border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary ${
              sizeInvalid ? "border-red-500" : "border-border"
            }`}
          />
          {sizeInvalid && (
            <p role="alert" className="text-xs text-red-600 mt-1">
              Entre {FOLIO_FONT_SIZE_MIN} y {FOLIO_FONT_SIZE_MAX} pt.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="foliar-color">Color</Label>
          <div className="flex items-center gap-2">
            <input
              id="foliar-color"
              type="color"
              value={config.color}
              onChange={(e) => update("color", e.target.value)}
              className="w-8 h-8 rounded border border-border cursor-pointer"
              aria-label="Color del folio"
            />
            <span className="text-xs text-text-muted">{config.color.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Range */}
      <div className="bg-bg rounded p-3">
        <Label>Rango de foliado</Label>
        <div className="space-y-2">
          <div>
            <label htmlFor="foliar-initial" className="block text-xs text-text-muted mb-1">Número inicial</label>
            <input
              id="foliar-initial"
              type="number"
              min={1}
              value={config.range.initialNumber}
              onChange={(e) => updateRange("initialNumber", Number(e.target.value))}
              className={`w-full bg-surface border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary ${
                initialInvalid ? "border-red-500" : "border-border"
              }`}
            />
            {initialInvalid && (
              <p role="alert" className="text-xs text-red-600 mt-1">Debe ser ≥ 1.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="foliar-from" className="block text-xs text-text-muted mb-1">Desde pág.</label>
              <input
                id="foliar-from"
                type="number"
                min={1}
                max={totalPages}
                value={config.range.from}
                onChange={(e) => updateRange("from", Number(e.target.value))}
                className={`w-full bg-surface border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary ${
                  fromInvalid ? "border-red-500" : "border-border"
                }`}
              />
            </div>
            <div>
              <label htmlFor="foliar-to" className="block text-xs text-text-muted mb-1">Hasta pág.</label>
              <input
                id="foliar-to"
                type="number"
                min={1}
                max={totalPages}
                value={config.range.to}
                onChange={(e) => updateRange("to", Number(e.target.value))}
                className={`w-full bg-surface border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary ${
                  toInvalid ? "border-red-500" : "border-border"
                }`}
              />
            </div>
          </div>
          {(fromInvalid || toInvalid) && (
            <p role="alert" className="text-xs text-red-600">
              {rangeError}
            </p>
          )}
          <p className="text-xs text-text-muted">
            Páginas {config.range.from} a {config.range.to} = folios {config.range.initialNumber} a {config.range.initialNumber + (config.range.to - config.range.from)}.
          </p>
        </div>
      </div>
    </div>
  );
}

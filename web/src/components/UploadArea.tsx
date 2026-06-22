import { useState, useRef } from "react";
import type { DragEvent, ChangeEvent } from "react";

type UploadAreaProps = {
  onFileSelected: (file: File) => void;
  accept?: string;
};

export default function UploadArea({
  onFileSelected,
  accept = "application/pdf,.pdf",
}: UploadAreaProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("El archivo debe ser un PDF.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setError(null);
    onFileSelected(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 1) {
      setError("Solo se puede procesar un archivo a la vez.");
      return;
    }
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary-light/20"
            : "border-border bg-surface hover:border-primary"
        }`}
      >
        <div className="text-5xl mb-3">📄</div>
        <p className="text-text font-medium">Arrastrá tu PDF acá</p>
        <p className="text-text-muted text-sm mt-1">o hacé clic para elegir un archivo</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onChange}
          className="hidden"
        />
      </div>
      {error && (
        <p role="alert" className="text-red-600 text-sm mt-2">{error}</p>
      )}
    </div>
  );
}

import type { ReactNode, KeyboardEvent } from "react";

type CardProps = {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  "aria-label"?: string;
};

export default function Card({ children, onClick, className = "", "aria-label": ariaLabel }: CardProps) {
  const interactive = Boolean(onClick);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!onClick) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  }

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? handleKeyDown : undefined}
      aria-label={ariaLabel}
      className={`bg-surface rounded-lg shadow-sm border border-border p-6 ${
        interactive ? "cursor-pointer hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-primary" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

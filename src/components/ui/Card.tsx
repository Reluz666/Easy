import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
};

export default function Card({ children, onClick, className = "" }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-surface rounded-lg shadow-sm border border-border p-6 ${
        onClick ? "cursor-pointer hover:shadow-md transition-shadow" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

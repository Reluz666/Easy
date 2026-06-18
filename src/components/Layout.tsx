import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

type LayoutProps = {
  children: ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const showHome = location.pathname !== "/";

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-surface border-b border-border px-6 py-4 flex items-center gap-4">
        <div className="font-semibold text-text">Easy PDF</div>
        {showHome && (
          <Link
            to="/"
            className="ml-auto text-sm text-primary hover:underline"
          >
            ← Inicio
          </Link>
        )}
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

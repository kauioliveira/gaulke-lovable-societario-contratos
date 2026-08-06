import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-primary text-primary-foreground shadow-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-foreground/10">
            <FileText className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-base font-semibold">Gaulke Contábil</div>
            <div className="text-[11px] uppercase tracking-wider opacity-80">
              Societário · Gerador de Contratos
            </div>
          </div>
        </Link>
        <div className="hidden text-xs opacity-80 sm:block">
          Descomplicando a contabilidade desde 1983
        </div>
      </div>
    </header>
  );
}

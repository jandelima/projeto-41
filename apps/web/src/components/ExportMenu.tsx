import { ChevronDown, Download, FileDown, FileSpreadsheet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui.js";

/**
 * Botão "Exportar": abre a escolha entre CSV e PDF.
 *
 * Cada formato é uma rota do servidor; o menu só abre o endereço numa aba.
 * Um formato sem endereço (`null`) aparece desabilitado, com o motivo.
 */
export function ExportMenu({
  csvUrl,
  pdfUrl,
  pdfHint
}: {
  csvUrl: string;
  /** `null` quando o recorte atual não dá para virar PDF. */
  pdfUrl: string | null;
  pdfHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
      } else if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function go(url: string) {
    setOpen(false);
    window.open(url, "_blank");
  }

  return (
    <div className="export-menu" ref={root}>
      <Button
        variant="ghost"
        icon={Download}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Exportar
        <ChevronDown size={15} />
      </Button>
      {open && (
        <div className="export-menu-panel" role="menu">
          <button type="button" role="menuitem" onClick={() => go(csvUrl)}>
            <FileSpreadsheet size={16} />
            CSV
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={pdfUrl == null}
            title={pdfUrl == null ? pdfHint : undefined}
            onClick={() => pdfUrl && go(pdfUrl)}
          >
            <FileDown size={16} />
            PDF
          </button>
        </div>
      )}
    </div>
  );
}

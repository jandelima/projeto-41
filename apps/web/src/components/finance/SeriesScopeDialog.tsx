import { useState } from "react";
import type { SeriesScope } from "@projeto41/contracts";
import { Modal } from "../dialog.js";
import { Button, Segmented } from "../ui.js";

export type SeriesScopeCounts = { one: number; forward: number; all: number };

/**
 * "Só esta / esta e as futuras / todas".
 *
 * A API é genérica de propósito e **não menciona parcela em lugar nenhum**: a
 * fase 7 vai reutilizar este mesmo componente para lançamentos recorrentes, e é
 * por isso que ele nasce em `components/finance/` e não dentro do drawer.
 *
 * Mostrar quantos lançamentos cada escolha afeta **antes** de confirmar é o que
 * separa uma escolha informada de um clique no escuro.
 */
export function SeriesScopeDialog({
  open,
  title = "Alterar lançamentos da série",
  description,
  counts,
  confirmLabel = "Aplicar",
  onPick,
  onCancel
}: {
  open: boolean;
  title?: string;
  description?: string;
  counts: SeriesScopeCounts;
  confirmLabel?: string;
  onPick: (scope: SeriesScope) => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<SeriesScope>("one");
  if (!open) return null;

  const plural = (count: number) => `${count} lançamento${count === 1 ? "" : "s"}`;

  return (
    <Modal title={title} onClose={onCancel} width={440}>
      <div className="stack fin-scope">
        {description && <p className="fin-muted">{description}</p>}

        <Segmented<SeriesScope>
          value={scope}
          onChange={setScope}
          options={[
            { value: "one", label: "Só esta" },
            { value: "forward", label: "Esta e as futuras" },
            { value: "all", label: "Todas" }
          ]}
        />

        <ul className="fin-scope-counts">
          <li data-active={scope === "one"}>Só esta · {plural(counts.one)}</li>
          <li data-active={scope === "forward"}>
            Esta e as futuras · {plural(counts.forward)}
          </li>
          <li data-active={scope === "all"}>Todas · {plural(counts.all)}</li>
        </ul>

        <div className="fin-scope-actions">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={() => onPick(scope)}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

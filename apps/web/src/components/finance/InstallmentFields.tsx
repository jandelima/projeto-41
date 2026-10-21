import { Minus, Plus } from "lucide-react";
import { useMemo } from "react";
import { installmentDates, splitCents, statementMonthFor } from "@projeto41/finance";
import { Segmented } from "../ui.js";
import { ledgerDate, monthLabel, moneyFromCents } from "../../lib/format.js";

const QUICK_COUNTS = [2, 3, 4, 6, 10, 12];

/** O valor digitado no formulário é o total da compra ou o de cada parcela. */
export type AmountBasis = "total" | "installment";

/** Total da compra a partir do valor digitado e da base escolhida. */
export function purchaseTotal(typedCents: number, basis: AmountBasis, count: number): number {
  return basis === "installment" ? typedCents * count : typedCents;
}

/**
 * Parcelamento de uma compra no crédito.
 *
 * A prévia usa o **mesmo** `splitCents` de `packages/finance` que o servidor —
 * uma divisão escrita à mão aqui divergiria do que é gravado, e o usuário veria
 * um valor na tela e outro no extrato.
 */
export function InstallmentFields({
  mode,
  onModeChange,
  installmentCount,
  onCountChange,
  basis = "total",
  onBasisChange,
  totalCents,
  purchaseDate,
  closingDay,
  dueDay,
  readOnly = false
}: {
  mode: "single" | "installments";
  onModeChange: (mode: "single" | "installments") => void;
  installmentCount: number;
  onCountChange: (count: number) => void;
  basis?: AmountBasis;
  onBasisChange?: (basis: AmountBasis) => void;
  /** Total da compra, já resolvido pela base. */
  totalCents: number | null;
  purchaseDate: string;
  closingDay: number;
  dueDay: number;
  /** Na edição de um plano, total e número viram texto (6.3). */
  readOnly?: boolean;
}) {
  const preview = useMemo(() => {
    if (totalCents == null || totalCents <= 0) return [];
    const count = mode === "installments" ? installmentCount : 1;
    const amounts = splitCents(totalCents, count);
    const dates = installmentDates(purchaseDate, count);
    return amounts.map((amountCents, index) => ({
      number: index + 1,
      amountCents,
      date: dates[index]!,
      statementMonth: statementMonthFor(dates[index]!, closingDay, dueDay)
    }));
  }, [mode, totalCents, installmentCount, purchaseDate, closingDay, dueDay]);

  if (readOnly) {
    return (
      <div className="fin-readonly-plan">
        <span className="field-label">Parcelamento</span>
        <p>
          {installmentCount}× de {moneyFromCents(Math.round((totalCents ?? 0) / installmentCount))}{" "}
          · total {moneyFromCents(totalCents ?? 0)}
        </p>
        {/* Campo desabilitado sem explicação faz o usuário tentar, não
            conseguir e não entender. */}
        <small className="fin-muted">
          Total e número de parcelas não mudam depois de criados. Para alterar,
          exclua o parcelamento e crie de novo.
        </small>
      </div>
    );
  }

  const first = preview[0];
  const setCount = (next: number) => onCountChange(Math.min(120, Math.max(2, next)));

  return (
    <div className="installment-box">
      <Segmented<"single" | "installments">
        value={mode}
        onChange={onModeChange}
        options={[
          { value: "single", label: "À vista" },
          { value: "installments", label: "Parcelado" }
        ]}
      />

      {mode === "installments" && (
        <>
          <div className="installment-count">
            <span className="field-label">Parcelas</span>
            <div className="installment-count-row">
              <div className="installment-stepper">
                <button
                  type="button"
                  aria-label="Menos uma parcela"
                  onClick={() => setCount(installmentCount - 1)}
                >
                  <Minus size={14} />
                </button>
                <input
                  type="number"
                  min={2}
                  max={120}
                  value={installmentCount}
                  aria-label="Número de parcelas"
                  onChange={(event) => setCount(Number(event.target.value) || 2)}
                />
                <button
                  type="button"
                  aria-label="Mais uma parcela"
                  onClick={() => setCount(installmentCount + 1)}
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="installment-quick">
                {QUICK_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={count === installmentCount ? "active" : ""}
                    onClick={() => setCount(count)}
                  >
                    {count}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          {onBasisChange && (
            <div className="installment-basis">
              <span className="field-label">O valor digitado é</span>
              <Segmented<AmountBasis>
                value={basis}
                onChange={onBasisChange}
                options={[
                  { value: "total", label: "O total da compra" },
                  { value: "installment", label: "O de cada parcela" }
                ]}
              />
            </div>
          )}
        </>
      )}

      {first && (
        <p className="installment-summary">
          {mode === "installments" ? (
            <>
              <strong>
                {installmentCount}× de {moneyFromCents(preview[preview.length - 1]!.amountCents)}
              </strong>{" "}
              · total {moneyFromCents(totalCents ?? 0)} · primeira parcela na fatura de{" "}
              {monthLabel(first.statementMonth)}
            </>
          ) : (
            <>
              Entra na fatura de <strong>{monthLabel(first.statementMonth)}</strong>
            </>
          )}
        </p>
      )}

      {mode === "installments" && preview.length > 1 && (
        <div className="fin-installment-preview">
          <span className="field-label">Prévia das parcelas</span>
          <ul>
            {preview.map((item) => (
              <li key={item.number}>
                <span>
                  {item.number}/{installmentCount} · {ledgerDate(item.date)}
                </span>
                <span className="fin-list-meta">
                  <small className="fin-muted">{monthLabel(item.statementMonth)}</small>
                  <strong>{moneyFromCents(item.amountCents)}</strong>
                </span>
              </li>
            ))}
          </ul>
          <small className="fin-muted">O resto dos centavos vai todo para a primeira parcela.</small>
        </div>
      )}
    </div>
  );
}

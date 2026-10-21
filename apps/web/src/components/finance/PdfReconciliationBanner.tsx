import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { PdfBatchInfo } from "@projeto41/contracts";
import { moneyFromCents, signedMoneyFromCents } from "../../lib/format.js";

/**
 * Faixa no topo da revisao de um PDF: a soma das linhas lidas contra o que o
 * proprio documento declara, eixo a eixo. Verde so quando todos batem; um
 * eixo divergente ou indisponivel deixa a faixa vermelha, com a diferenca.
 */
export function PdfReconciliationBanner({ info, rowCount }: { info: PdfBatchInfo; rowCount: number }) {
  const { reconciliation, warnings } = info;
  const failing = reconciliation.axes.filter((axis) => axis.status !== "match");
  const matched = reconciliation.axes.length - failing.length;
  const ok = reconciliation.status === "match";
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  // Os eixos se sobrepoem (o saldo final contem os dias), entao somar as
  // diferencas contaria o mesmo centavo varias vezes: mostra a maior.
  const largestDifference = Math.max(0, ...failing.map((axis) => Math.abs(axis.differenceCents ?? 0)));

  return (
    <section className={`fin-pdf-reconcile ${ok ? "match" : "mismatch"}`} aria-live="polite">
      <header>
        <Icon size={18} aria-hidden />
        <strong>
          {ok
            ? `Soma confere com o PDF: ${rowCount} lançamento(s), ${matched} conferência(s) batendo.`
            : failing.some((axis) => axis.status === "unavailable")
              ? "O PDF não traz um total para conferir — revise cada linha antes de importar."
              : `${failing.length} de ${reconciliation.axes.length} conferências não batem com o que o PDF declara (maior diferença: ${moneyFromCents(largestDifference)}) — confira antes de importar.`}
        </strong>
      </header>
      {failing.length > 0 && (
        <ul>
          {failing.map((axis) => (
            <li key={axis.key}>
              <span>{axis.label}</span>
              {axis.status === "unavailable" ? (
                <span>sem total no documento</span>
              ) : (
                <span className="num">
                  declarado {signedMoneyFromCents(axis.declaredCents ?? 0)} · lido{" "}
                  {signedMoneyFromCents(axis.parsedCents)} · diferença{" "}
                  {signedMoneyFromCents(axis.differenceCents ?? 0)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      <p>
        Importação de PDF sempre passa pela revisão, linha a linha: nada é gravado em lote, mesmo com a
        soma batendo.
      </p>
    </section>
  );
}

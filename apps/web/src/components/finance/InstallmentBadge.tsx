import type { EntryRecord } from "@projeto41/contracts";

/**
 * Número e total da parcela.
 *
 * Vem do plano de parcelas quando existe. Parcela lançada solta (como as
 * importadas da planilha, uma linha por mês) guarda o número na observação,
 * "Parcela 2/6" — e ela também merece o rótulo.
 */
export function installmentOf(
  entry: Pick<EntryRecord, "installmentNumber" | "installmentCount" | "notes">
): { number: number; count: number } | null {
  if (entry.installmentNumber != null && entry.installmentCount != null) {
    return { number: entry.installmentNumber, count: entry.installmentCount };
  }
  const match = /(?:^|\n)Parcela (\d+)\/(\d+)/.exec(entry.notes ?? "");
  if (!match) return null;
  return { number: Number(match[1]), count: Number(match[2]) };
}

/**
 * Rótulo `3/7` da parcela.
 *
 * A **última** parcela recebe destaque discreto — borda no token de acento, não
 * cor chapada nem ícone novo. Os dois pontos, rótulo e destaque, foram pedidos
 * explicitamente: não unificar num só.
 */
export function InstallmentBadge({ entry, long = false }: { entry: EntryRecord; long?: boolean }) {
  const installment = installmentOf(entry);
  if (!installment) return null;
  const isLast = installment.number === installment.count;
  return (
    <em
      className={`fin-installment ${isLast ? "last" : ""}`}
      title={isLast ? "última parcela" : `parcela ${installment.number} de ${installment.count}`}
    >
      {long ? "Parcela " : ""}
      {installment.number}/{installment.count}
    </em>
  );
}

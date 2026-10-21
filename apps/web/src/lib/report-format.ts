/** "+34%", "−43%", ou "novo" quando não havia base para comparar. */
export function variationText(currentCents: number, previousCents: number) {
  if (previousCents === 0) return currentCents === 0 ? "0%" : "novo";
  const percent = Math.round(((currentCents - previousCents) / previousCents) * 100);
  if (percent === 0) return "0%";
  return percent > 0 ? `+${percent}%` : `−${Math.abs(percent)}%`;
}

/** Gastar mais é o tom ruim; gastar menos, o bom. */
export function spendTone(currentCents: number, previousCents: number) {
  if (currentCents > previousCents) return "fin-negative";
  if (currentCents < previousCents) return "fin-positive";
  return "fin-muted";
}


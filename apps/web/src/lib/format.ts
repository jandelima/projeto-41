const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 1
});
const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const pctFmt = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

// Modo privacidade: oculta valores em dinheiro e quantidades (não as %).
const MASK = "••••";
let masked = false;
export function setValuesMasked(value: boolean) {
  masked = value;
}

export function money(value: number) {
  return masked ? `R$ ${MASK}` : brl.format(value || 0);
}

export function usd(value: number) {
  return masked ? `$ ${MASK}` : usdFmt.format(value || 0);
}

export function currency(value: number, code: "BRL" | "USD" | string) {
  return code === "USD" ? usd(value) : money(value);
}

// Cotações de mercado (preço unitário) não são sensíveis -> nunca mascaradas.
export function currencyRaw(value: number, code: "BRL" | "USD" | string) {
  return code === "USD" ? usdFmt.format(value || 0) : brl.format(value || 0);
}

export function percent(value: number) {
  return pctFmt.format(value || 0);
}

export function signedPercent(value: number) {
  const text = percent(value);
  return value > 0 ? `+${text}` : text;
}

export function decimal(value: number, digits = 2) {
  if (masked) return MASK;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value || 0);
}

// Cotação USD/BRL: número público, não revela patrimônio -> nunca mascarado.
export function fx(value: number, digits = 4) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value || 0);
}

export function compactMoney(value: number) {
  return masked ? MASK : brlCompact.format(value || 0);
}

export function shortDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", {
    month: "short",
    year: "2-digit"
  });
}

export function longDate(value: string) {
  if (!value) return "—";
  if (value === "1900-01-01") return "Data não informada";
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
}

export function relativeTime(iso: string | null | undefined) {
  if (!iso) return "sem cotação";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} d`;
}

export const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
];
export const monthShort = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez"
];

export const categoryLabels: Record<string, string> = {
  crypto: "Cripto",
  b3: "Bolsa B3",
  dollar: "Dólar",
  dolar: "Dólar",
  cash: "Caixa BR",
  caixa_br: "Caixa BR",
  reserve: "Reserva",
  fixed_income: "Renda fixa",
  renda_fixa: "Renda fixa",
  global: "Ações globais",
  acoes_globais: "Ações globais",
  bolsa_brasil: "Bolsa B3",
  bitcoin: "Bitcoin",
  shitcoins: "Altcoins"
};

export function categoryLabel(key: string) {
  return categoryLabels[key] ?? key;
}

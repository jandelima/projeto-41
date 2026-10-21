const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 1
});
// Dólar também no formato brasileiro: "US$ 1.669,27". Em "$1,669.27" ao lado
// de "R$ 8.582,37" a vírgula e o ponto trocavam de papel na mesma tela.
const usdFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
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
  return masked ? `US$ ${MASK}` : usdFmt.format(value || 0);
}

export function currency(value: number, code: "BRL" | "USD" | string) {
  return code === "USD" ? usd(value) : money(value);
}

/**
 * Casas decimais de um preço unitário. Acima de 1 bastam os centavos; abaixo,
 * o preço precisa de dígitos até mostrar três significativos — senão uma
 * moeda a US$ 0,0000123 aparecia como "US$ 0,00", que não diz nada.
 */
export function priceFractionDigits(value: number) {
  const magnitude = Math.abs(value || 0);
  if (magnitude === 0 || magnitude >= 1) return 2;
  return Math.min(10, Math.max(2, Math.ceil(-Math.log10(magnitude)) + 2));
}

const priceFormats = new Map<string, Intl.NumberFormat>();
function priceFormat(code: string, digits: number) {
  const key = `${code}:${digits}`;
  let format = priceFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: code === "USD" ? "USD" : "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: digits
    });
    priceFormats.set(key, format);
  }
  return format;
}

// Cotações de mercado (preço unitário) não são sensíveis -> nunca mascaradas.
export function currencyRaw(value: number, code: "BRL" | "USD" | string) {
  return priceFormat(code, priceFractionDigits(value)).format(value || 0);
}

export function percent(value: number) {
  return pctFmt.format(value || 0);
}

export function percentValue(value: number, digits = 2) {
  const text = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value || 0);
  return `${text}%`;
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
  // Classes do livro-caixa (fase 4). O prefixo `ledger:` evita colisão com as
  // chaves do dashboard e com os apelidos das metas de alocação.
  "ledger:bank": "Contas bancárias",
  "ledger:cash": "Dinheiro vivo",
  "ledger:voucher": "Vale-refeição",
  "ledger:goals": "Caixinhas",
  "ledger:credit_card": "Cartão (dívida)",
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

// --- Módulo de finanças: tudo entra em centavos inteiros (D19) --------------
// Cada formatador novo precisa honrar a máscara do modo privacidade — um que
// ignore a flag vaza valores na gravação de tela (R-04).

/**
 * Data de uma linha do livro: dia e mes, com o ano so quando nao e o corrente.
 * `shortDate` nao serve aqui porque ela agrega por mes, que e o que os graficos
 * de investimento precisam e o extrato nao.
 */
export function ledgerDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    ...(sameYear ? {} : { year: "2-digit" })
  });
}

/**
 * Dia da semana de uma data `YYYY-MM-DD`: "Quinta-feira" ou, curto, "qui".
 * Meio-dia local para o fuso nunca empurrar a data para o dia anterior.
 */
export function weekdayName(value: string, style: "long" | "short" = "long") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const name = new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { weekday: style });
  if (style === "short") return name.replace(".", "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Rótulo de um mês `YYYY-MM`, como "Maio de 2026". */
export function monthLabel(month: string) {
  const [year, index] = month.split("-");
  return `${monthNames[Number(index) - 1] ?? month} de ${year}`;
}

export function moneyFromCents(cents: number) {
  return money((cents || 0) / 100);
}

/** Mostra o sinal explícito: usado na coluna de valor do livro. */
export function signedMoneyFromCents(cents: number) {
  if (masked) return `R$ ${MASK}`;
  const value = (cents || 0) / 100;
  return value > 0 ? `+${brl.format(value)}` : brl.format(value);
}

export function compactMoneyFromCents(cents: number) {
  return compactMoney((cents || 0) / 100);
}

/** Saldo devedor de cartão: sempre positivo, já é "quanto eu devo". */
export function debtFromCents(cents: number) {
  return moneyFromCents(Math.abs(cents || 0));
}

/**
 * Par `gasto/orçamento` da tabela de totais (6.5). Sem orçamento mostra só o
 * gasto — nada de placeholder.
 */
export function budgetPair(spentCents: number, budgetCents: number | null | undefined) {
  const spent = moneyFromCents(Math.abs(spentCents));
  if (budgetCents == null) return spent;
  return `${spent} / ${moneyFromCents(budgetCents)}`;
}

/** Campo de entrada: converte centavos no texto editável em pt-BR. */
/**
 * Hoje em `YYYY-MM-DD` no fuso de quem usa. `toISOString()` é UTC: depois das
 * 21h em Brasília ele já devolve amanhã, e a compra cai na fatura errada.
 */
export function todayIso(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function centsToInput(cents: number | null | undefined) {
  if (cents == null) return "";
  return (Math.abs(cents) / 100).toFixed(2).replace(".", ",");
}

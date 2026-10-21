import type { WriterItem, WriterPage } from "./pdf-writer.js";

/**
 * Extrato do BTG **sintetico**, com as coordenadas do layout real de 2026-10 e
 * nenhum dado de verdade: nomes ficticios, CPF e conta mascarados. Gera a
 * fixture `__fixtures__/btg-extrato/2026-10.pdf` e e usado direto em teste.
 */

export type FixtureRow = {
  date: string;
  time: string;
  category: string[];
  transaction: string[];
  description: string;
  cents: number;
};

const ROWS: FixtureRow[] = [
  { date: "28/09/2026", time: "11h27", category: ["Transferência"], transaction: ["Pix recebido"], description: "Fulana de Tal", cents: 16000 },
  { date: "28/09/2026", time: "11h34", category: ["Cuidados", "Pessoais"], transaction: ["Pix enviado"], description: "Academia Exemplo", cents: -8000 },
  { date: "28/09/2026", time: "12h15", category: ["Transferência"], transaction: ["Pix recebido"], description: "Corretora Ficticia Ltda", cents: 221280 },
  { date: "29/09/2026", time: "11h05", category: ["Transporte"], transaction: ["Pix enviado"], description: "Uber", cents: -713 },
  { date: "29/09/2026", time: "17h41", category: ["Viagem"], transaction: ["Pix enviado por Fulana de", "Tal"], description: "Padaria Do Exemplo", cents: -2243 },
  { date: "29/09/2026", time: "22h34", category: ["Outra Categoria"], transaction: ["Pix enviado"], description: "Instituicao De Pagamento Teste", cents: -3644 },
  { date: "30/09/2026", time: "08h13", category: ["Saúde"], transaction: ["Pix enviado"], description: "Farmácia Modelo", cents: -13000 },
  { date: "30/09/2026", time: "11h34", category: ["Investimentos"], transaction: ["Transferência recebida"], description: "Beltrano Da Silva", cents: 80000 },
  { date: "30/09/2026", time: "15h21", category: ["Lazer e", "Entretenimento"], transaction: ["Pix enviado"], description: "Posto Exemplo", cents: -10000 },
  { date: "01/10/2026", time: "09h00", category: ["Alimentação"], transaction: ["Pix enviado"], description: "Mercadinho Teste", cents: -123456 },
  { date: "01/10/2026", time: "10h38", category: ["Transferência"], transaction: ["Pix recebido"], description: "Beltrano Da Silva", cents: 4000 }
];

/** Quantas linhas impressas cabem na primeira pagina: forca a quebra. */
const ROWS_ON_FIRST_PAGE = 8;

function money(cents: number) {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents < 0 ? "-" : ""}R$ ${whole},${String(abs % 100).padStart(2, "0")}`;
}

function pageHeader(closingCents: number): WriterItem[] {
  return [
    { text: "Olá Fulano!", x: 105, yTop: 32.7, size: 10, bold: true },
    { text: "Este é o extrato da sua conta corrente BTG Pactual", x: 105, yTop: 59.2, size: 10 },
    { text: "Extrato de conta corrente", x: 25, yTop: 84.2, size: 10, bold: true },
    { text: "18/10/2026 19h12", x: 474.4, yTop: 84.2, size: 10 },
    { text: "Cliente:", x: 43, yTop: 112.7 },
    { text: "Fulano De Teste", x: 142, yTop: 111.2, bold: true },
    { text: "CPF:", x: 43, yTop: 123.7 },
    { text: "***.***.***-**", x: 142, yTop: 122.2, bold: true },
    { text: "Agência:", x: 43, yTop: 134.7 },
    { text: "00", x: 142, yTop: 133.2, bold: true },
    { text: "Conta:", x: 43, yTop: 145.7 },
    { text: "*******-*", x: 142, yTop: 144.2, bold: true },
    { text: "Período do extrato:", x: 43, yTop: 156.7 },
    { text: "18/09/2026 a 18/10/2026", x: 142, yTop: 155.2, bold: true },
    { text: "Lançamentos:", x: 25, yTop: 189.2, size: 10, bold: true },
    { text: "Saldo atual", x: 395, yTop: 189.2, size: 10 },
    { text: money(closingCents), x: 555, yTop: 189.2, size: 10, align: "right" },
    { text: "Data e hora", x: 46.6, yTop: 230.8 },
    { text: "Categoria", x: 122.7, yTop: 230.8 },
    { text: "Transação", x: 216.1, yTop: 230.8 },
    { text: "Descrição", x: 377.2, yTop: 230.8 },
    { text: "Valor", x: 513.2, yTop: 230.8 }
  ];
}

/** Celula de uma ou mais linhas, centrada na linha da data como no BTG. */
function cell(lines: string[], x: number, center: number): WriterItem[] {
  const step = 9.3;
  const top = center - ((lines.length - 1) * step) / 2;
  return lines.map((text, index) => ({ text, x, yTop: top + index * step }));
}

export function btgFixturePages(rows: FixtureRow[] = ROWS): WriterPage[] {
  const days = [...new Set(rows.map((row) => row.date))];
  // Saldo de partida qualquer: o primeiro dia nao tem conferencia, de proposito.
  let balance = 0;
  const lines: ({ kind: "row"; row: FixtureRow } | { kind: "balance"; date: string; cents: number })[] = [];
  for (const day of days) {
    for (const row of rows.filter((candidate) => candidate.date === day)) {
      balance += row.cents;
      lines.push({ kind: "row", row });
    }
    lines.push({ kind: "balance", date: day, cents: balance });
  }

  const pages: WriterPage[] = [];
  const chunks = [lines.slice(0, ROWS_ON_FIRST_PAGE), lines.slice(ROWS_ON_FIRST_PAGE)];
  for (const chunk of chunks) {
    const items = pageHeader(balance);
    let y = 253.3;
    for (const line of chunk) {
      if (line.kind === "balance") {
        items.push(
          { text: `${line.date} 23h59`, x: 30, yTop: y },
          { text: "Saldo Diário", x: 300, yTop: y },
          { text: money(line.cents), x: 555, yTop: y, align: "right" }
        );
        y += 15;
        continue;
      }
      const { row } = line;
      const tall = Math.max(row.category.length, row.transaction.length) > 1;
      if (tall) y += 1.5;
      items.push(
        { text: `${row.date} ${row.time}`, x: 30, yTop: y },
        ...cell(row.category, 110, y),
        ...cell(row.transaction, 175, y),
        { text: row.description, x: 300, yTop: y },
        { text: money(row.cents), x: 555, yTop: y, align: "right" }
      );
      y += tall ? 18 : 15;
    }
    pages.push({ items });
  }
  pages[pages.length - 1]!.items.push(
    { text: "Ouvidoria: 0800-000-0000 ou ouvidoria@exemplo.com", x: 300, yTop: 745.4, size: 9 },
    { text: "©BTG Pactual - CNPJ 00.000.000/0000-00", x: 300, yTop: 759.4, size: 9 }
  );
  return pages;
}

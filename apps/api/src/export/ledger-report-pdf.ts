import type { EntryRecord } from "@projeto41/contracts";
import PDFDocument from "pdfkit";
import type { LedgerReport, ReportAccount, ReportCategory } from "./ledger-report.js";

/**
 * Desenha o relatorio do livro em PDF (A4).
 *
 * Pagina 1: totais, uma linha por conta (entradas, saidas, transferencias e
 * fatura dos cartoes) e as categorias de saida e de entrada, cada uma com a
 * sua pizza. Paginas seguintes: as transacoes, contas antes de cartoes, um
 * bloco por conta.
 *
 * O layout e posicionado a mao (margem zero no pdfkit): nenhum texto quebra
 * linha nem abre pagina sozinho, entao a paginacao e so a de `ensureSpace`.
 */

type Doc = PDFKit.PDFDocument;

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT = PAGE.width - MARGIN * 2;
const BOTTOM = PAGE.height - 48;

const COLOR = {
  text: "#111827",
  muted: "#6b7280",
  border: "#e5e7eb",
  zebra: "#f8fafc",
  band: "#f1f5f9",
  positive: "#0f9d6b",
  negative: "#e0356b",
  accent: "#0f766e",
  others: "#9ca3af"
};

/** Para categoria sem cor (ou com cor repetida): distinguiveis entre si. */
const PALETTE = [
  "#2563eb",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#ec4899",
  "#64748b",
  "#14b8a6",
  "#a855f7"
];

const KIND_LABEL: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Conta corrente",
  cash: "Dinheiro",
  meal_voucher: "Vale-refeição",
  credit_card: "Cartão de crédito",
  investment: "Investimento",
  goal: "Caixinha"
};

const GROUP_LABEL: Record<ReportAccount["group"], string> = {
  accounts: "Contas",
  cards: "Cartões",
  savings: "Caixinhas e investimentos"
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** `R$ 1.234,56`, com espaco comum: o Intl usa NBSP. */
export function money(cents: number) {
  return brl.format(cents / 100).replace(/\u00a0/g, " ");
}

function signedMoney(cents: number) {
  return cents > 0 ? `+${money(cents)}` : money(cents);
}

export function brDate(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function percent(perMille: number) {
  return `${(perMille / 10).toFixed(1).replace(".", ",")}%`;
}

function toneOf(cents: number) {
  return cents < 0 ? COLOR.negative : cents > 0 ? COLOR.positive : COLOR.muted;
}

/** Corta o texto com reticencias para caber na largura, na fonte atual. */
function fit(doc: Doc, text: string, width: number) {
  if (doc.widthOfString(text) <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (doc.widthOfString(`${text.slice(0, middle)}…`) <= width) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
}

type Cell = { text: string; x: number; width: number; align?: "left" | "right"; color?: string; bold?: boolean };

function row(doc: Doc, y: number, cells: Cell[], size = 8.5) {
  for (const cell of cells) {
    doc
      .font(cell.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(size)
      .fillColor(cell.color ?? COLOR.text)
      .text(fit(doc, cell.text, cell.width), cell.x, y, {
        width: cell.width,
        align: cell.align ?? "left",
        lineBreak: false
      });
  }
}

/** Cores das categorias: a do banco quando valida e unica, senao a da paleta. */
function categoryColors(categories: ReportCategory[]) {
  const used = new Set<string>();
  let next = 0;
  return categories.map((category) => {
    if (category.name === "Outras" && !category.color) return COLOR.others;
    const own = category.color && /^#[0-9a-f]{6}$/i.test(category.color) ? category.color.toLowerCase() : null;
    if (own && !used.has(own)) {
      used.add(own);
      return own;
    }
    while (used.has(PALETTE[next % PALETTE.length]!) && next < PALETTE.length * 2) next += 1;
    const color = PALETTE[next % PALETTE.length]!;
    next += 1;
    used.add(color);
    return color;
  });
}

function drawPie(doc: Doc, cx: number, cy: number, radius: number, categories: ReportCategory[], colors: string[]) {
  const total = categories.reduce((sum, category) => sum + category.cents, 0);
  if (total <= 0) {
    doc.circle(cx, cy, radius).lineWidth(1).strokeColor(COLOR.border).stroke();
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text("Sem lançamentos", cx - radius, cy - 4, { width: radius * 2, align: "center", lineBreak: false });
    return;
  }
  let angle = -Math.PI / 2;
  categories.forEach((category, index) => {
    const sweep = (category.cents / total) * Math.PI * 2;
    if (sweep <= 0) return;
    const color = colors[index]!;
    if (sweep >= Math.PI * 2 - 1e-6) {
      doc.circle(cx, cy, radius).fill(color);
    } else {
      const x1 = cx + radius * Math.cos(angle);
      const y1 = cy + radius * Math.sin(angle);
      const x2 = cx + radius * Math.cos(angle + sweep);
      const y2 = cy + radius * Math.sin(angle + sweep);
      const large = sweep > Math.PI ? 1 : 0;
      doc
        .path(`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`)
        .fill(color);
    }
    angle += sweep;
  });
  // Fatias separadas por um fio branco, e um furo no meio: lê melhor impresso.
  angle = -Math.PI / 2;
  doc.lineWidth(1).strokeColor("#ffffff");
  for (const category of categories) {
    doc
      .moveTo(cx, cy)
      .lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle))
      .stroke();
    angle += (category.cents / total) * Math.PI * 2;
  }
  doc.circle(cx, cy, radius * 0.45).fill("#ffffff");
}

class ReportWriter {
  readonly doc: Doc;
  y = MARGIN;

  constructor(private readonly report: LedgerReport) {
    this.doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
      info: {
        Title: `Relatório financeiro ${brDate(report.range.from)} a ${brDate(report.range.to)}`,
        Author: "Projeto 41",
        Creator: "Projeto 41"
      }
    });
  }

  newPage() {
    this.doc.addPage();
    this.y = MARGIN;
  }

  /** Abre pagina nova se `height` nao cabe; devolve se abriu. */
  ensureSpace(height: number) {
    if (this.y + height <= BOTTOM) return false;
    this.newPage();
    return true;
  }

  heading(text: string, size = 12) {
    this.doc.font("Helvetica-Bold").fontSize(size).fillColor(COLOR.text).text(text, MARGIN, this.y, {
      width: CONTENT,
      lineBreak: false
    });
    this.y += size + 8;
  }

  // Pagina 1 ------------------------------------------------------------------

  cover() {
    const { doc, report } = this;
    doc.rect(0, 0, PAGE.width, 6).fill(COLOR.accent);
    doc.font("Helvetica-Bold").fontSize(20).fillColor(COLOR.text).text("Relatório financeiro", MARGIN, 32, {
      lineBreak: false
    });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(COLOR.muted)
      .text(`${brDate(report.range.from)} a ${brDate(report.range.to)}`, MARGIN, 58, { lineBreak: false })
      .text(`Gerado em ${brDate(report.generatedAt.slice(0, 10))} às ${report.generatedAt.slice(11, 16)} · Projeto 41`, MARGIN, 58, {
        width: CONTENT,
        align: "right",
        lineBreak: false
      });
    this.y = 86;
    this.kpis();
    this.accountsTable();
    this.categories();
  }

  kpis() {
    const { doc, report } = this;
    const gap = 10;
    const width = (CONTENT - gap * 3) / 4;
    const height = 54;
    const cards = [
      { label: "Entradas", cents: report.totals.incomeCents, color: COLOR.positive },
      { label: "Saídas", cents: report.totals.expenseCents, color: COLOR.negative },
      { label: "Resultado", cents: report.totals.netCents, color: toneOf(report.totals.netCents) },
      { label: "Faturas dos cartões", cents: report.totals.invoiceCents, color: COLOR.text }
    ];
    cards.forEach((card, index) => {
      const x = MARGIN + index * (width + gap);
      doc.roundedRect(x, this.y, width, height, 6).fill(COLOR.band);
      doc.rect(x, this.y, 3, height).fill(card.color);
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(COLOR.muted)
        .text(card.label.toUpperCase(), x + 12, this.y + 11, { width: width - 18, lineBreak: false });
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .fillColor(card.color)
        .text(fit(doc.font("Helvetica-Bold").fontSize(13), money(card.cents), width - 18), x + 12, this.y + 28, {
          width: width - 18,
          lineBreak: false
        });
    });
    this.y += height + 22;
  }

  accountsTable() {
    const { doc, report } = this;
    this.heading("Por conta");
    const columns = { name: 175, income: 82, expense: 82, transfers: 88, invoice: 88 };
    const x = {
      name: MARGIN,
      income: MARGIN + columns.name,
      expense: MARGIN + columns.name + columns.income,
      transfers: MARGIN + columns.name + columns.income + columns.expense,
      invoice: MARGIN + columns.name + columns.income + columns.expense + columns.transfers
    };
    const header = () => {
      row(
        doc,
        this.y,
        [
          { text: "Conta", x: x.name, width: columns.name, color: COLOR.muted, bold: true },
          { text: "Entradas", x: x.income, width: columns.income, align: "right", color: COLOR.muted, bold: true },
          { text: "Saídas", x: x.expense, width: columns.expense, align: "right", color: COLOR.muted, bold: true },
          { text: "Transferências", x: x.transfers, width: columns.transfers, align: "right", color: COLOR.muted, bold: true },
          { text: "Fatura", x: x.invoice, width: columns.invoice, align: "right", color: COLOR.muted, bold: true }
        ],
        8
      );
      this.y += 13;
      doc.moveTo(MARGIN, this.y).lineTo(MARGIN + CONTENT, this.y).lineWidth(0.6).strokeColor(COLOR.border).stroke();
      this.y += 5;
    };
    header();
    if (report.accounts.length === 0) {
      row(doc, this.y, [{ text: "Nenhum lançamento no período.", x: MARGIN, width: CONTENT, color: COLOR.muted }]);
      this.y += 18;
    }
    let group: ReportAccount["group"] | null = null;
    for (const account of report.accounts) {
      if (this.ensureSpace(30)) header();
      if (group !== account.group) {
        group = account.group;
        row(doc, this.y, [
          { text: GROUP_LABEL[account.group].toUpperCase(), x: MARGIN, width: CONTENT, color: COLOR.accent, bold: true }
        ], 7.5);
        this.y += 12;
      }
      doc.circle(MARGIN + 4, this.y + 4, 3.2).fill(account.color ?? COLOR.muted);
      row(doc, this.y, [
        { text: account.name, x: x.name + 12, width: columns.name - 12, bold: true },
        { text: money(account.incomeCents), x: x.income, width: columns.income, align: "right", color: account.incomeCents ? COLOR.positive : COLOR.muted },
        { text: money(account.expenseCents), x: x.expense, width: columns.expense, align: "right", color: account.expenseCents ? COLOR.negative : COLOR.muted },
        { text: signedMoney(account.transfersCents), x: x.transfers, width: columns.transfers, align: "right", color: COLOR.muted },
        {
          text: account.invoiceCents == null ? "—" : money(account.invoiceCents),
          x: x.invoice,
          width: columns.invoice,
          align: "right",
          color: account.invoiceCents == null ? COLOR.muted : COLOR.text,
          bold: account.invoiceCents != null
        }
      ]);
      this.y += 16;
    }
    doc.moveTo(MARGIN, this.y).lineTo(MARGIN + CONTENT, this.y).lineWidth(0.6).strokeColor(COLOR.border).stroke();
    this.y += 5;
    row(doc, this.y, [
      { text: "Total", x: x.name, width: columns.name, bold: true },
      { text: money(report.totals.incomeCents), x: x.income, width: columns.income, align: "right", color: COLOR.positive, bold: true },
      { text: money(report.totals.expenseCents), x: x.expense, width: columns.expense, align: "right", color: COLOR.negative, bold: true },
      {
        text: signedMoney(report.accounts.reduce((sum, account) => sum + account.transfersCents, 0)),
        x: x.transfers,
        width: columns.transfers,
        align: "right",
        color: COLOR.muted,
        bold: true
      },
      { text: money(report.totals.invoiceCents), x: x.invoice, width: columns.invoice, align: "right", bold: true }
    ]);
    this.y += 26;
  }

  categories() {
    const { report } = this;
    this.ensureSpace(140);
    this.heading("Categorias");
    this.categoryBlock("Saídas por categoria", report.expenseCategories, COLOR.negative);
    this.categoryBlock("Entradas por categoria", report.incomeCategories, COLOR.positive);
  }

  /**
   * Pizza a esquerda, legenda a direita com todas as categorias (valor e %),
   * em duas colunas quando sao muitas: o resumo inteiro cabe na primeira pagina.
   */
  private categoryBlock(title: string, categories: ReportCategory[], tone: string) {
    const { doc } = this;
    const radius = 46;
    const pieWidth = radius * 2 + 24;
    const lineHeight = 10.5;
    const split = categories.length > 9;
    const rows = split ? Math.ceil(categories.length / 2) : categories.length;
    const height = 18 + Math.max(radius * 2, rows * lineHeight) + 16;
    this.ensureSpace(Math.min(height, BOTTOM - MARGIN));

    const total = categories.reduce((sum, category) => sum + category.cents, 0);
    row(doc, this.y, [
      { text: title, x: MARGIN, width: CONTENT / 2, bold: true },
      { text: money(total), x: MARGIN + CONTENT / 2, width: CONTENT / 2, align: "right", color: tone, bold: true }
    ], 9.5);
    this.y += 18;
    const colors = categoryColors(categories);
    const top = this.y;
    drawPie(doc, MARGIN + radius + 4, top + radius, radius, categories, colors);

    const legendX = MARGIN + pieWidth;
    const legendWidth = CONTENT - pieWidth;
    const columnWidth = split ? (legendWidth - 16) / 2 : legendWidth;
    let y = top;
    categories.forEach((category, index) => {
      const column = split && index >= rows ? 1 : 0;
      if (index === rows) y = top;
      // Legenda maior que a pagina: continua na seguinte, na mesma coluna.
      if (y + lineHeight > BOTTOM) {
        this.newPage();
        y = this.y;
      }
      const x = legendX + column * (columnWidth + 16);
      doc.rect(x, y + 1, 7, 7).fill(colors[index]!);
      row(doc, y, [
        { text: category.name, x: x + 12, width: columnWidth - 112 },
        { text: money(category.cents), x: x + columnWidth - 98, width: 66, align: "right" },
        { text: percent(category.sharePerMille), x: x + columnWidth - 30, width: 30, align: "right", color: COLOR.muted }
      ], 7.5);
      y += lineHeight;
      if (column === 0) this.y = Math.max(this.y, y);
    });
    this.y = Math.max(this.y, top + radius * 2, y) + 16;
  }

  // Transacoes ----------------------------------------------------------------

  transactions() {
    const groups = (["accounts", "cards", "savings"] as const).map((group) => ({
      title: `Transações — ${GROUP_LABEL[group].toLowerCase()}`,
      accounts: this.report.accounts.filter((account) => account.group === group)
    }));
    for (const group of groups) {
      if (group.accounts.length === 0) continue;
      this.newPage();
      this.heading(group.title, 16);
      this.y += 2;
      for (const account of group.accounts) this.accountBlock(account);
    }
  }

  private static readonly COLUMNS = { date: 58, description: 247, category: 120, amount: 90 };

  private tableHeader() {
    const { doc } = this;
    const c = ReportWriter.COLUMNS;
    row(doc, this.y, [
      { text: "Data", x: MARGIN + 6, width: c.date, color: COLOR.muted, bold: true },
      { text: "Descrição", x: MARGIN + c.date, width: c.description, color: COLOR.muted, bold: true },
      { text: "Categoria", x: MARGIN + c.date + c.description, width: c.category, color: COLOR.muted, bold: true },
      { text: "Valor", x: MARGIN + c.date + c.description + c.category, width: c.amount - 6, align: "right", color: COLOR.muted, bold: true }
    ], 7.5);
    this.y += 11;
    doc.moveTo(MARGIN, this.y).lineTo(MARGIN + CONTENT, this.y).lineWidth(0.6).strokeColor(COLOR.border).stroke();
    this.y += 3;
  }

  private accountTitle(account: ReportAccount, continued: boolean) {
    const { doc } = this;
    doc.roundedRect(MARGIN, this.y, CONTENT, 34, 5).fill(COLOR.band);
    doc.rect(MARGIN, this.y, 4, 34).fill(account.color ?? COLOR.muted);
    row(doc, this.y + 6, [
      { text: `${account.name}${continued ? " (continuação)" : ""}`, x: MARGIN + 12, width: CONTENT * 0.55, bold: true }
    ], 11);
    const parts = [
      `Entradas ${money(account.incomeCents)}`,
      `Saídas ${money(account.expenseCents)}`,
      `Transferências ${signedMoney(account.transfersCents)}`,
      ...(account.invoiceCents != null ? [`Fatura ${money(account.invoiceCents)}`] : [])
    ];
    row(doc, this.y + 21, [
      { text: `${KIND_LABEL[account.kind] ?? account.kind} · ${account.entries.length} lançamento(s)`, x: MARGIN + 12, width: CONTENT * 0.4, color: COLOR.muted },
      { text: parts.join("  ·  "), x: MARGIN + CONTENT * 0.4, width: CONTENT * 0.6 - 10, align: "right", color: COLOR.muted }
    ], 7.5);
    this.y += 42;
  }

  private accountBlock(account: ReportAccount) {
    const { doc } = this;
    const c = ReportWriter.COLUMNS;
    this.ensureSpace(42 + 14 + 15 * Math.min(account.entries.length, 3));
    this.accountTitle(account, false);
    this.tableHeader();
    if (account.entries.length === 0) {
      row(doc, this.y + 3, [{ text: "Sem lançamentos no período; só a fatura.", x: MARGIN + 6, width: CONTENT, color: COLOR.muted }]);
      this.y += 18;
    }
    account.entries.forEach((entry, index) => {
      if (this.ensureSpace(15)) {
        this.accountTitle(account, true);
        this.tableHeader();
      }
      if (index % 2 === 1) doc.rect(MARGIN, this.y - 1, CONTENT, 15).fill(COLOR.zebra);
      row(doc, this.y + 3, [
        { text: brDate(entry.date), x: MARGIN + 6, width: c.date - 6, color: COLOR.muted },
        { text: describe(entry), x: MARGIN + c.date, width: c.description - 8 },
        {
          text: entry.categoryName ?? (entry.kind === "transfer" ? "Transferência" : entry.kind === "adjustment" ? "Ajuste" : "—"),
          x: MARGIN + c.date + c.description,
          width: c.category - 8,
          color: COLOR.muted
        },
        {
          text: signedMoney(entry.amountCents),
          x: MARGIN + c.date + c.description + c.category,
          width: c.amount - 6,
          align: "right",
          color: entry.kind === "transfer" ? COLOR.muted : toneOf(entry.amountCents)
        }
      ]);
      this.y += 15;
    });
    this.y += 14;
  }

  footer() {
    const { doc, report } = this;
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      doc.moveTo(MARGIN, PAGE.height - 34).lineTo(MARGIN + CONTENT, PAGE.height - 34).lineWidth(0.5).strokeColor(COLOR.border).stroke();
      row(doc, PAGE.height - 28, [
        { text: `Projeto 41 · Relatório de ${brDate(report.range.from)} a ${brDate(report.range.to)}`, x: MARGIN, width: CONTENT / 2, color: COLOR.muted },
        { text: `Página ${index - range.start + 1} de ${range.count}`, x: MARGIN + CONTENT / 2, width: CONTENT / 2, align: "right", color: COLOR.muted }
      ], 7.5);
    }
  }
}

/** O texto da linha: o que o usuario escreveu, o local, o texto do banco ou a outra conta. */
function describe(entry: EntryRecord) {
  const base =
    entry.description?.trim() ||
    entry.placeName?.trim() ||
    entry.rawDescription?.trim() ||
    (entry.kind === "transfer" && entry.counterpartAccountName
      ? `Transferência ${entry.amountCents < 0 ? "para" : "de"} ${entry.counterpartAccountName}`
      : "—");
  const installment =
    entry.installmentNumber != null && entry.installmentCount != null
      ? ` (${entry.installmentNumber}/${entry.installmentCount})`
      : "";
  return `${base}${installment}`;
}

export function renderLedgerReportPdf(report: LedgerReport): Promise<Buffer> {
  const writer = new ReportWriter(report);
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    writer.doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    writer.doc.on("end", () => resolve(Buffer.concat(chunks)));
    writer.doc.on("error", reject);
  });
  writer.cover();
  writer.transactions();
  writer.footer();
  writer.doc.end();
  return done;
}

/**
 * Reconstrucao de tabela a partir de x/y. Tudo puro: entra item com
 * coordenada, sai estrutura.
 */
import type { PdfItem } from "./text-layer.js";

export type Line = { yTop: number; items: PdfItem[] };

/**
 * Agrupa itens em linhas por `yTop`. A tolerancia e proporcional a altura da
 * fonte, e nao um valor fixo em pontos: o rodape em fonte menor quebraria uma
 * tolerancia fixa. Cada linha sai ordenada por x.
 */
export function groupIntoLines(items: PdfItem[], tolerance = 0.4): Line[] {
  const sorted = [...items].sort((a, b) => a.yTop - b.yTop || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(item.yTop - last.yTop) <= tolerance * Math.max(item.fontHeight, 1)) {
      last.items.push(item);
    } else {
      lines.push({ yTop: item.yTop, items: [item] });
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

export type ColumnSpec<K extends string> = { key: K; label: string; align: "left" | "right" };
/**
 * `edge` e a borda alinhada da coluna: a esquerda para texto, a direita para
 * valor. E ela, e nao a posicao do titulo, que diz a que coluna um item pertence.
 */
export type Column<K extends string> = ColumnSpec<K> & { edge: number };

/** Itens a ate esta distancia (pt) da borda da coluna estao alinhados com ela. */
const EDGE_TOLERANCE = 1.5;

function mostFrequent(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) {
    const key = Math.round(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Infere a borda de cada coluna pela densidade das bordas dos itens.
 *
 * O titulo so diz a ordem e a regiao: no extrato ele e centralizado sobre uma
 * coluna cujo texto e alinhado a esquerda, entao a fronteira "no meio entre os
 * titulos" corta itens curtos para a coluna vizinha. A borda de verdade e a
 * borda mais frequente dos itens entre o centro do titulo anterior e o centro
 * deste — a esquerda para texto, a direita para valor.
 *
 * Devolve `null` se faltar um titulo ou se uma coluna nao tiver borda: sem
 * isso nao ha tabela confiavel.
 */
export function detectColumns<K extends string>(
  header: Line,
  specs: ColumnSpec<K>[],
  items: PdfItem[]
): Column<K>[] | null {
  const centers: number[] = [];
  for (const spec of specs) {
    const title = header.items.find((candidate) => candidate.text.trim() === spec.label);
    if (!title) return null;
    centers.push(title.x + title.width / 2);
  }
  const columns: Column<K>[] = [];
  for (const [index, spec] of specs.entries()) {
    const from = index === 0 ? -Infinity : centers[index - 1]!;
    const to = index === specs.length - 1 ? Infinity : centers[index]!;
    const edges =
      spec.align === "left"
        ? items.map((item) => item.x).filter((x) => x > from && x <= to)
        : items.map((item) => item.x + item.width).filter((right) => right > from);
    const edge = mostFrequent(edges);
    if (edge === null) return null;
    columns.push({ ...spec, edge });
  }
  return columns;
}

export type AssignedRow<K extends string> = {
  cells: Record<K, string>;
  /** Algum item nao alinhou com nenhuma coluna: a linha precisa de olho humano. */
  ambiguous: boolean;
  /** Alguma celula ocupa mais de uma linha impressa. */
  wrapped: boolean;
};

/**
 * Distribui os itens nas colunas pela borda alinhada. Item que nao encosta
 * em nenhuma borda vai para a coluna de texto que comeca antes dele, e a
 * linha e marcada `ambiguous` — nunca chutada em silencio.
 */
export function assignToColumns<K extends string>(
  items: PdfItem[],
  columns: Column<K>[]
): AssignedRow<K> {
  const parts = Object.fromEntries(columns.map((column) => [column.key, [] as PdfItem[]])) as Record<
    K,
    PdfItem[]
  >;
  let ambiguous = false;
  for (const item of items) {
    const aligned = columns.find((column) =>
      column.align === "left"
        ? Math.abs(item.x - column.edge) <= EDGE_TOLERANCE
        : Math.abs(item.x + item.width - column.edge) <= EDGE_TOLERANCE
    );
    if (aligned) {
      parts[aligned.key].push(item);
      continue;
    }
    ambiguous = true;
    const before = columns
      .filter((column) => column.align === "left" && column.edge <= item.x)
      .sort((a, b) => b.edge - a.edge)[0];
    if (before) parts[before.key].push(item);
  }
  let wrapped = false;
  const cells = Object.fromEntries(
    columns.map((column) => {
      const pieces = parts[column.key].sort((a, b) => a.yTop - b.yTop || a.x - b.x);
      if (new Set(pieces.map((piece) => Math.round(piece.yTop))).size > 1) wrapped = true;
      return [column.key, pieces.map((piece) => piece.text.trim()).join(" ")];
    })
  ) as Record<K, string>;
  return { cells, ambiguous, wrapped };
}

/**
 * Junta as linhas de continuacao na linha-pai.
 *
 * No extrato, celula longa quebra em duas ou tres linhas impressas centradas
 * na linha da data (`Cuidados` / `Pessoais`). Cada item vai para a ancora
 * (linha com data) mais proxima em y, desde que a distancia caiba em
 * `maxDistance` alturas de fonte; o que nao cabe perto de nenhuma ancora
 * (cabecalho, rodape) fica de fora.
 */
export function mergeContinuationLines(
  items: PdfItem[],
  isAnchor: (item: PdfItem) => boolean,
  maxDistance = 1.3
): { anchor: PdfItem; items: PdfItem[] }[] {
  const anchors = items.filter(isAnchor).sort((a, b) => a.yTop - b.yTop);
  const groups = anchors.map((anchor) => ({ anchor, items: [] as PdfItem[] }));
  for (const item of items) {
    let best: (typeof groups)[number] | null = null;
    let bestDistance = Infinity;
    for (const group of groups) {
      const distance = Math.abs(group.anchor.yTop - item.yTop);
      if (distance < bestDistance) {
        best = group;
        bestDistance = distance;
      }
    }
    if (best && bestDistance <= maxDistance * Math.max(item.fontHeight, 1)) best.items.push(item);
  }
  return groups;
}

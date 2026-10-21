import { addMonths, formatMonth, parseMonth } from "@projeto41/finance";
import type { Db } from "./shared.js";

/**
 * Consultas de relatorio.
 *
 * Este repositorio **so consulta**. Nenhuma regra de 6.4, 6.5 ou 6.6 e
 * reimplementada em SQL: ele entrega somas cruas e `packages/finance` faz
 * percentual, orcamento, comparacao e alvo.
 */

export type CategoryTotalRow = {
  categoryId: number | null;
  name: string;
  color: string | null;
  monthlyBudgetCents: number | null;
  budgetSharePerMille: number | null;
  totalCents: number;
};

export type PeriodRange = { from: string; to: string };

export function createReportsRepository(db: Db) {
  const repository = {
    /**
     * Total por categoria no periodo.
     *
     * Transferencia fica de fora (D21) — senao o pagamento de fatura vira
     * despesa e o gasto conta duas vezes. Lancamento sem categoria vira a linha
     * `Sem categoria`: esconde-la maquiaria o total.
     */
    totalsByCategory: (
      range: PeriodRange,
      options: { kind?: "income" | "expense" } = {}
    ): CategoryTotalRow[] => {
      const kind = options.kind ?? "expense";
      return db
        .prepare(
          `SELECT
             e.category_id AS categoryId,
             COALESCE(c.name, 'Sem categoria') AS name,
             c.color,
             c.monthly_budget_cents AS monthlyBudgetCents,
             c.budget_share_per_mille AS budgetSharePerMille,
             -- Saída é negativa no livro e entrada positiva: o total sai sempre
             -- positivo, ou o relatório de entradas viria todo negativo.
             CASE WHEN @kind = 'income' THEN SUM(e.amount_cents) ELSE -SUM(e.amount_cents) END
               AS totalCents
           FROM entries e
           LEFT JOIN categories c ON c.id = e.category_id
           WHERE e.kind = @kind AND e.date >= @from AND e.date <= @to
           GROUP BY e.category_id
           ORDER BY totalCents DESC`
        )
        .all({ ...range, kind }) as CategoryTotalRow[];
    },

    monthSummary: (range: PeriodRange) =>
      db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_cents END), 0) AS incomeCents,
             COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_cents END), 0) AS expenseCents,
             COALESCE(SUM(CASE WHEN kind IN ('income','expense') THEN amount_cents END), 0)
               AS netCents
           FROM entries
           WHERE date >= @from AND date <= @to`
        )
        .get(range) as { incomeCents: number; expenseCents: number; netCents: number },

    /** O mesmo `monthSummary`, separado por conta. Conta sem lancamento nao vem. */
    monthSummaryByAccount: (range: PeriodRange) =>
      db
        .prepare(
          `SELECT
             account_id AS accountId,
             COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_cents END), 0) AS incomeCents,
             COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_cents END), 0) AS expenseCents,
             COALESCE(SUM(CASE WHEN kind IN ('income','expense') THEN amount_cents END), 0)
               AS netCents
           FROM entries
           WHERE date >= @from AND date <= @to
           GROUP BY account_id`
        )
        .all(range) as {
        accountId: number;
        incomeCents: number;
        expenseCents: number;
        netCents: number;
      }[],

    /**
     * Serie mensal por categoria.
     *
     * Os meses sem lancamento sao preenchidos com zero aqui, e nao no grafico:
     * um `GROUP BY` sem linha some com o mes e a area desenha uma reta enganosa
     * entre dois pontos distantes.
     */
    trendByCategory: (options: {
      categoryIds?: number[];
      months: number;
      endMonth: string;
      kind?: "income" | "expense";
    }) => {
      const kind = options.kind ?? "expense";
      const end = parseMonth(options.endMonth);
      const monthKeys = Array.from({ length: options.months }, (_, index) =>
        formatMonth(addMonths(end, index - (options.months - 1)))
      );
      const firstMonth = monthKeys[0] ?? options.endMonth;

      const filter =
        options.categoryIds && options.categoryIds.length > 0
          ? `AND e.category_id IN (${options.categoryIds.join(",")})`
          : "";

      const rows = db
        .prepare(
          `SELECT
             e.category_id AS categoryId,
             COALESCE(c.name, 'Sem categoria') AS name,
             c.color,
             strftime('%Y-%m', e.date) AS month,
             -SUM(e.amount_cents) AS totalCents
           FROM entries e
           LEFT JOIN categories c ON c.id = e.category_id
           WHERE e.kind = @kind
             AND strftime('%Y-%m', e.date) >= @firstMonth
             AND strftime('%Y-%m', e.date) <= @endMonth
             ${filter}
           GROUP BY e.category_id, month`
        )
        .all({ kind, firstMonth, endMonth: options.endMonth }) as {
        categoryId: number | null;
        name: string;
        color: string | null;
        month: string;
        totalCents: number;
      }[];

      const byCategory = new Map<
        number | null,
        { categoryId: number | null; name: string; color: string | null; totals: Map<string, number> }
      >();
      for (const row of rows) {
        const existing = byCategory.get(row.categoryId) ?? {
          categoryId: row.categoryId,
          name: row.name,
          color: row.color,
          totals: new Map<string, number>()
        };
        existing.totals.set(row.month, row.totalCents);
        byCategory.set(row.categoryId, existing);
      }

      // Categorias pedidas que não tiveram nenhum lançamento ainda precisam
      // aparecer como série zerada, senão o gráfico some com a linha.
      for (const categoryId of options.categoryIds ?? []) {
        if (byCategory.has(categoryId)) continue;
        const category = db
          .prepare("SELECT name, color FROM categories WHERE id = ?")
          .get(categoryId) as { name: string; color: string } | undefined;
        if (!category) continue;
        byCategory.set(categoryId, {
          categoryId,
          name: category.name,
          color: category.color,
          totals: new Map()
        });
      }

      return [...byCategory.values()].map((category) => ({
        categoryId: category.categoryId,
        name: category.name,
        color: category.color,
        points: monthKeys.map((month) => ({
          month,
          totalCents: category.totals.get(month) ?? 0
        }))
      }));
    },

    /**
     * Renda por pessoa no periodo, **sem filtro de status**: o alvo e sobre o
     * mes combinado, nao sobre a liquidacao bancaria (6.4, diferente de 6.1).
     */
    incomeByPerson: (range: PeriodRange): Record<number, number> => {
      const rows = db
        .prepare(
          `SELECT person_id AS personId, COALESCE(SUM(amount_cents), 0) AS totalCents
           FROM entries
           WHERE kind = 'income' AND person_id IS NOT NULL
             AND date >= @from AND date <= @to
           GROUP BY person_id`
        )
        .all(range) as { personId: number; totalCents: number }[];
      return Object.fromEntries(rows.map((row) => [row.personId, row.totalCents]));
    },

    /** Realizado por pessoa: o que `counts_toward_target` marcou (6.4). */
    realizedByPerson: (range: PeriodRange): Record<number, number> => {
      const rows = db
        .prepare(
          `SELECT person_id AS personId, -COALESCE(SUM(amount_cents), 0) AS totalCents
           FROM entries
           WHERE counts_toward_target = 1 AND person_id IS NOT NULL
             AND date >= @from AND date <= @to
           GROUP BY person_id`
        )
        .all(range) as { personId: number; totalCents: number }[];
      return Object.fromEntries(rows.map((row) => [row.personId, row.totalCents]));
    },

    /** Soma dos orcamentos de categoria de saida, fallback do alvo total (6.5). */
    categoryBudgetSum: (): number =>
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(monthly_budget_cents), 0) AS total
             FROM categories
             WHERE kind = 'expense' AND archived = 0 AND monthly_budget_cents IS NOT NULL`
          )
          .get() as { total: number }
      ).total
  };

  return repository;
}

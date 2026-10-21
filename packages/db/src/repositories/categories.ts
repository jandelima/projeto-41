import type { CategoryDraft, CategoryKind, CategoryRecord } from "@projeto41/contracts";
import { countBlockingReferences, fromBit, notFound, nowIso, toBit, type Db } from "./shared.js";

type CategoryRow = {
  id: number;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string | null;
  monthlyBudgetCents: number | null;
  budgetSharePerMille: number | null;
  archived: number;
  sortOrder: number;
};

const SELECT = `
  SELECT id, name, kind, color, icon,
         monthly_budget_cents AS monthlyBudgetCents,
         budget_share_per_mille AS budgetSharePerMille,
         archived, sort_order AS sortOrder
  FROM categories
`;

/** Percentual vence: quem mandou os dois ja foi barrado no contrato. */
function exclusiveBudget(budget: {
  monthlyBudgetCents?: number | null;
  budgetSharePerMille?: number | null;
}) {
  const share = budget.budgetSharePerMille ?? null;
  return {
    budgetSharePerMille: share,
    monthlyBudgetCents: share != null ? null : (budget.monthlyBudgetCents ?? null)
  };
}

const map = (row: CategoryRow): CategoryRecord => ({
  ...row,
  archived: fromBit(row.archived)
});

export function createCategoriesRepository(db: Db) {
  return {
    list: (options: { kind?: CategoryKind; includeArchived?: boolean } = {}): CategoryRecord[] => {
      const where: string[] = [];
      const params: Record<string, unknown> = {};
      if (options.kind) {
        where.push("kind = @kind");
        params.kind = options.kind;
      }
      if (!options.includeArchived) where.push("archived = 0");
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      return (
        db
          .prepare(`${SELECT} ${clause} ORDER BY kind, sort_order, name`)
          .all(params) as CategoryRow[]
      ).map(map);
    },

    get: (id: number): CategoryRecord | undefined => {
      const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as CategoryRow | undefined;
      return row ? map(row) : undefined;
    },

    create: (category: CategoryDraft): number =>
      Number(
        db
          .prepare(
            `INSERT INTO categories
             (name, kind, color, icon, monthly_budget_cents, budget_share_per_mille,
              archived, sort_order, created_at)
             VALUES (@name, @kind, @color, @icon, @monthlyBudgetCents, @budgetSharePerMille,
                     @archived, @sortOrder, @createdAt)`
          )
          .run({
            name: category.name,
            kind: category.kind,
            color: category.color,
            icon: category.icon ?? null,
            ...exclusiveBudget(category),
            archived: toBit(category.archived, false),
            sortOrder: category.sortOrder ?? 0,
            createdAt: nowIso()
          }).lastInsertRowid
      ),

    update: (id: number, category: CategoryDraft): number => {
      const changes = db
        .prepare(
          `UPDATE categories SET name=@name, kind=@kind, color=@color, icon=@icon,
           monthly_budget_cents=@monthlyBudgetCents,
           budget_share_per_mille=@budgetSharePerMille,
           archived=@archived, sort_order=@sortOrder
           WHERE id=@id`
        )
        .run({
          id,
          name: category.name,
          kind: category.kind,
          color: category.color,
          icon: category.icon ?? null,
          ...exclusiveBudget(category),
          archived: toBit(category.archived, false),
          sortOrder: category.sortOrder ?? 0
        }).changes;
      if (changes === 0) throw notFound("Categoria");
      return changes;
    },

    /**
     * Grava o objetivo sem tocar no resto do cadastro. E o caminho da tela de
     * alocacao de gastos, que so conhece o objetivo: um PUT completo zeraria
     * cor, ordem e arquivamento que ela nao mandou.
     *
     * Definir um modo apaga o outro — objetivo em valor e em percentual sao
     * exclusivos.
     */
    setBudget: (
      id: number,
      budget:
        | number
        | null
        | {
            monthlyBudgetCents?: number | null;
            budgetSharePerMille?: number | null;
          }
    ): number => {
      const normalized =
        typeof budget === "object" && budget !== null
          ? exclusiveBudget(budget)
          : { monthlyBudgetCents: budget, budgetSharePerMille: null };
      const changes = db
        .prepare(
          `UPDATE categories
             SET monthly_budget_cents = @monthlyBudgetCents,
                 budget_share_per_mille = @budgetSharePerMille
           WHERE id = @id`
        )
        .run({ id, ...normalized }).changes;
      if (changes === 0) throw notFound("Categoria");
      return changes;
    },

    archive: (id: number): number => {
      const changes = db.prepare("UPDATE categories SET archived = 1 WHERE id = ?").run(id).changes;
      if (changes === 0) throw notFound("Categoria");
      return changes;
    },

    /**
     * Categoria usada em lancamento ou como padrao de local nao some: vira
     * arquivada, para nao quebrar relatorio antigo. Devolve 0 nesse caso.
     */
    remove: (id: number): number => {
      const used = countBlockingReferences(db, "categories", id);
      if (used > 0) {
        db.prepare("UPDATE categories SET archived = 1 WHERE id = ?").run(id);
        return 0;
      }
      const changes = db.prepare("DELETE FROM categories WHERE id = ?").run(id).changes;
      if (changes === 0) throw notFound("Categoria");
      return changes;
    }
  };
}

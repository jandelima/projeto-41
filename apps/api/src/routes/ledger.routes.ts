import {
  accountSchema,
  categorySchema,
  entryFilterSchema,
  entrySchema,
  entryTargetFlagSchema,
  seriesScopeSchema,
  personSchema,
  placeSchema,
  tagSchema,
  transferSchema
} from "@projeto41/contracts";
import { z } from "zod";
import {
  accountAttachmentIds,
  accountUsage,
  assertAccountPurgeable,
  purgeAccount,
  purgeCategory,
  purgePerson
} from "../services/purge-service.js";
import type { RoutePlugin } from "./index.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Rotas do livro-caixa.
 *
 * Convencao do app: toda mutacao devolve o agregado recalculado
 * (`{ ok: true, balances }`) para o frontend atualizar numa ida so. Mensagens de
 * erro em portugues sem acento; `LedgerError` carrega `statusCode` e o error
 * handler global de `app.ts` ja o traduz.
 */
/**
 * Booleano de query string. `z.coerce.boolean()` le "false" como true (string
 * nao vazia), e `?includeArchived=false` traria justamente os arquivados.
 */
const queryBoolean = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

/**
 * `?purge=1` exclui de vez, resolvendo os vínculos (ver purge-service). Sem
 * ele, o DELETE continua arquivando o que está em uso.
 */
const purgeQuery = z.object({ purge: queryBoolean.optional() });

export const registerLedgerRoutes: RoutePlugin = (app, { db, attachmentService }) => {
  const ledger = db.ledger;
  const balances = () => ledger.balances.consolidated();

  // Pessoas -----------------------------------------------------------------
  app.get("/api/ledger/people", async () => ledger.people.list());
  app.post("/api/ledger/people", async (request, reply) => {
    const id = ledger.people.create(personSchema.parse(request.body));
    return reply.status(201).send({ id, people: ledger.people.list() });
  });
  app.put("/api/ledger/people/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.people.update(id, personSchema.parse(request.body));
    return { ok: true, people: ledger.people.list() };
  });
  app.delete("/api/ledger/people/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    if (purgeQuery.parse(request.query).purge) {
      const result = purgePerson(db, id);
      return { ok: true, archived: false, ...result, people: ledger.people.list() };
    }
    const removed = ledger.people.remove(id);
    return { ok: true, archived: removed === 0, people: ledger.people.list() };
  });

  // Contas ------------------------------------------------------------------
  app.get("/api/ledger/accounts", async (request) => {
    const query = z
      .object({ includeArchived: queryBoolean.optional() })
      .parse(request.query);
    return ledger.accounts.list({ includeArchived: query.includeArchived });
  });
  app.post("/api/ledger/accounts", async (request, reply) => {
    const id = ledger.accounts.create(accountSchema.parse(request.body));
    return reply.status(201).send({ id, balances: balances() });
  });
  app.put("/api/ledger/accounts/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.accounts.update(id, accountSchema.parse(request.body));
    return { ok: true, balances: balances() };
  });
  /** O que a exclusão definitiva leva junto: a tela mostra antes de confirmar. */
  app.get("/api/ledger/accounts/:id/usage", async (request) =>
    accountUsage(db, idParam.parse(request.params).id)
  );
  app.delete("/api/ledger/accounts/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    if (purgeQuery.parse(request.query).purge) {
      assertAccountPurgeable(db, id);
      // Arquivos primeiro: depois do DELETE não há mais como achá-los.
      for (const attachmentId of accountAttachmentIds(db, id)) {
        await attachmentService?.remove(attachmentId);
      }
      const result = purgeAccount(db, id);
      return { ok: true, archived: false, ...result, balances: balances() };
    }
    const removed = ledger.accounts.remove(id);
    return { ok: true, archived: removed === 0, balances: balances() };
  });

  // Categorias --------------------------------------------------------------
  app.get("/api/ledger/categories", async (request) => {
    const query = z
      .object({
        kind: z.enum(["income", "expense"]).optional(),
        includeArchived: queryBoolean.optional()
      })
      .parse(request.query);
    return ledger.categories.list(query);
  });
  app.post("/api/ledger/categories", async (request, reply) => {
    const id = ledger.categories.create(categorySchema.parse(request.body));
    return reply.status(201).send({ id, categories: ledger.categories.list() });
  });
  app.put("/api/ledger/categories/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.categories.update(id, categorySchema.parse(request.body));
    return { ok: true, categories: ledger.categories.list() };
  });
  // Só o objetivo: a tela de alocação de gastos não conhece o resto do
  // cadastro e um PUT completo zeraria o que ela não mandou.
  app.put("/api/ledger/categories/:id/budget", async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        monthlyBudgetCents: z.number().int().nonnegative().nullable().optional(),
        budgetSharePerMille: z.number().int().min(0).max(1000).nullable().optional()
      })
      .refine((value) => value.monthlyBudgetCents == null || value.budgetSharePerMille == null, {
        message: "O objetivo e em valor ou em percentual, nao os dois"
      })
      .parse(request.body);
    ledger.categories.setBudget(id, body);
    return { ok: true, categories: ledger.categories.list() };
  });
  app.delete("/api/ledger/categories/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    if (purgeQuery.parse(request.query).purge) {
      const result = purgeCategory(db, id);
      return {
        ok: true,
        archived: false,
        ...result,
        categories: ledger.categories.list({ includeArchived: true })
      };
    }
    const removed = ledger.categories.remove(id);
    return {
      ok: true,
      archived: removed === 0,
      categories: ledger.categories.list({ includeArchived: true })
    };
  });

  // Etiquetas ---------------------------------------------------------------
  app.get("/api/ledger/tags", async () => ledger.tags.list());
  app.post("/api/ledger/tags", async (request, reply) => {
    // Nome que já existe devolve a etiqueta existente: o banco recusaria o
    // nome repetido e o usuário veria "Erro interno".
    const input = tagSchema.parse(request.body);
    const existing = ledger.tags.list().find(
      (tag) => tag.name.trim().toLocaleLowerCase("pt-BR") === input.name.trim().toLocaleLowerCase("pt-BR")
    );
    if (existing) return reply.status(200).send({ id: existing.id, tags: ledger.tags.list() });
    const id = ledger.tags.create(input);
    return reply.status(201).send({ id, tags: ledger.tags.list() });
  });
  app.put("/api/ledger/tags/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.tags.update(id, tagSchema.parse(request.body));
    return { ok: true, tags: ledger.tags.list() };
  });
  app.delete("/api/ledger/tags/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.tags.remove(id);
    return { ok: true, tags: ledger.tags.list() };
  });

  // Locais ------------------------------------------------------------------
  app.get("/api/ledger/places", async (request) => {
    const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(
      request.query
    );
    return ledger.places.list(search);
  });
  app.post("/api/ledger/places", async (request, reply) => {
    // O formulário cria o local pelo nome digitado quando ninguém escolheu a
    // sugestão. Se ele já existe, é ele: recusar derrubava o lançamento inteiro.
    const input = placeSchema.parse(request.body);
    const existing = ledger.places.getByName(input.name);
    if (existing) return reply.status(200).send({ id: existing.id, place: existing });
    const id = ledger.places.create(input);
    return reply.status(201).send({ id, place: ledger.places.get(id) });
  });
  app.put("/api/ledger/places/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.places.update(id, placeSchema.parse(request.body));
    return { ok: true, place: ledger.places.get(id) };
  });
  app.delete("/api/ledger/places/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const removed = ledger.places.remove(id);
    return { ok: true, kept: removed === 0 };
  });

  // Lancamentos -------------------------------------------------------------
  app.get("/api/ledger/entries", async (request) =>
    ledger.entries.list(entryFilterSchema.parse(request.query))
  );

  app.get("/api/ledger/entries/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const entry = ledger.entries.get(id);
    if (!entry) return reply.status(404).send({ error: "Lancamento nao encontrado" });
    return entry;
  });

  app.post("/api/ledger/entries", async (request, reply) => {
    const id = ledger.entries.create(entrySchema.parse(request.body));
    return reply.status(201).send({ id, entry: ledger.entries.get(id), balances: balances() });
  });

  /**
   * `scope` so tem efeito quando o lancamento pertence a um plano de parcelas.
   *
   * Ele vale para campos **nao monetarios** (descricao, categoria, local,
   * pessoa, etiquetas). **Valor e sempre `one`**: alterar o valor da serie
   * inteira quebraria a invariante de soma da secao 4.2, entao a combinacao e
   * recusada em vez de aceita pela metade.
   */
  app.put("/api/ledger/entries/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { scope } = z
      .object({ scope: seriesScopeSchema.default("one") })
      .parse(request.query);
    const existing = ledger.entries.get(id);
    if (!existing) return reply.status(404).send({ error: "Lancamento nao encontrado" });

    const input = entrySchema.parse(request.body);
    if (scope !== "one" && input.amountCents !== existing.amountCents) {
      return reply.status(400).send({
        error: "Alterar valor so vale para esta parcela: use scope=one"
      });
    }

    ledger.entries.update(id, input);

    if (scope !== "one" && existing.installmentPlanId != null) {
      const siblings = ledger.entries
        .listAll({ installmentPlanId: existing.installmentPlanId, pageSize: 500 })
        .filter((row) => row.id !== id)
        .filter((row) =>
          scope === "all" ? true : (row.installmentNumber ?? 0) > (existing.installmentNumber ?? 0)
        );
      for (const sibling of siblings) {
        // Só os campos descritivos viajam pela série. Status, pessoa, notas e
        // forma de pagamento são de cada parcela: copiar o status da primeira
        // marcava as futuras como pagas e as tirava do saldo pendente.
        ledger.entries.update(sibling.id, {
          accountId: sibling.accountId,
          personId: sibling.personId,
          date: sibling.date,
          amountCents: sibling.amountCents,
          kind: sibling.kind,
          status: sibling.status,
          categoryId: input.categoryId ?? null,
          placeId: input.placeId ?? null,
          description: input.description ?? null,
          notes: sibling.notes,
          paymentMethod: sibling.paymentMethod,
          statementMonth: sibling.statementMonth,
          refundOfEntryId: sibling.refundOfEntryId,
          tagIds: input.tagIds
        });
      }
    }

    return { ok: true, entry: ledger.entries.get(id), balances: balances() };
  });

  app.delete("/api/ledger/entries/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.entries.get(id)) {
      return reply.status(404).send({ error: "Lancamento nao encontrado" });
    }
    ledger.entries.remove(id);
    return { ok: true, balances: balances() };
  });

  /** Excecao manual de 6.4: a unica porta para sobrescrever o flag derivado. */
  app.patch("/api/ledger/entries/:id/target", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.entries.get(id)) {
      return reply.status(404).send({ error: "Lancamento nao encontrado" });
    }
    const { countsTowardTarget } = entryTargetFlagSchema.parse(request.body);
    ledger.entries.setCountsTowardTarget(id, countsTowardTarget);
    return { ok: true, entry: ledger.entries.get(id) };
  });

  app.post("/api/ledger/entries/status", async (request) => {
    const body = z
      .object({
        ids: z.array(z.number().int().positive()).min(1),
        status: z.enum(["pending", "cleared", "reconciled"])
      })
      .parse(request.body);
    const changed = ledger.entries.setStatus(body.ids, body.status);
    return { ok: true, changed, balances: balances() };
  });

  // Transferencias ----------------------------------------------------------
  app.post("/api/ledger/transfers", async (request, reply) => {
    const result = ledger.entries.createTransfer(transferSchema.parse(request.body));
    return reply.status(201).send({ ...result, balances: balances() });
  });

  // Saldos ------------------------------------------------------------------
  app.get("/api/ledger/balances", async (request) => {
    const query = z
      .object({
        asOf: z.string().date().optional(),
        includeArchived: queryBoolean.optional()
      })
      .parse(request.query);
    return ledger.balances.consolidated(query);
  });
};

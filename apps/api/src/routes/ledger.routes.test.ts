import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

type App = ReturnType<typeof buildApp>;

const priceService = { runAll: async () => [] };

let db: AppDatabase;
let app: App;
let steylor: number;
let checking: number;
let savings: number;
let mercado: number;

async function post(url: string, payload: Record<string, unknown>) {
  return await app.inject({ method: "POST", url, payload });
}

beforeEach(async () => {
  db = createTestDatabase();
  app = buildApp({ db, priceService });
  await app.ready();

  steylor = (await app.inject("/api/ledger/people").then((r) => r.json()))[0].id;

  checking = (
    await post("/api/ledger/accounts", {
      name: "Nubank",
      kind: "checking",
      color: "#8a2be2",
      personId: steylor,
      openingBalanceCents: 100_00
    })
  ).json().id;

  savings = (
    await post("/api/ledger/accounts", {
      name: "Poupanca",
      kind: "cash",
      color: "#00a86b",
      personId: steylor
    })
  ).json().id;

  const categories = await app
    .inject("/api/ledger/categories?kind=expense")
    .then((r) => r.json());
  mercado = categories.find((c: { name: string }) => c.name === "Mercado").id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

const baseExpense = () => ({
  accountId: checking,
  date: "2026-03-10",
  amountCents: -4500,
  kind: "expense" as const,
  categoryId: mercado
});

describe("cadastros do livro", () => {
  it("semeia pessoas e categorias e devolve na listagem", async () => {
    const people = await app.inject("/api/ledger/people").then((r) => r.json());
    expect(people.map((p: { name: string }) => p.name)).toEqual([
      "Steylor",
      "Bianca",
      "Conjunto"
    ]);
  });

  it("cria conta e devolve os saldos recalculados", async () => {
    const response = await post("/api/ledger/accounts", {
      name: "Carteira",
      kind: "cash",
      color: "#ffaa00",
      personId: steylor,
      openingBalanceCents: 5000
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().balances.consolidatedCents).toBe(150_00);
  });

  it("o saldo da conta continua inteiro com dinheiro marcado em caixinha (base do ajuste de saldo)", async () => {
    await post("/api/ledger/entries", {
      accountId: checking,
      date: "2026-01-05",
      amountCents: 50_00,
      kind: "income",
      status: "cleared"
    });
    const goal = (
      await post("/api/ledger/goals", { name: "Viagem", mode: "earmark", accountId: checking, color: "#123456" })
    ).json().id;
    expect((await post(`/api/ledger/goals/${goal}/mark`, { amountCents: 30_00 })).statusCode).toBe(200);

    // O ajuste compara o que o usuário digita com este número: marcar em
    // caixinha não tira dinheiro da conta, então não pode tirar do saldo.
    const balances = await app.inject("/api/ledger/balances").then((r) => r.json());
    const nubank = balances.accounts.find((a: { id: number }) => a.id === checking);
    expect(nubank.currentBalanceCents).toBe(150_00);
  });

  it("exige ciclo ao criar cartao (D04)", async () => {
    const response = await post("/api/ledger/accounts", {
      name: "Cartao",
      kind: "credit_card",
      color: "#ff0000",
      personId: steylor
    });
    expect(response.statusCode).toBe(400);
  });

  it("resolve local por nome normalizado (D06)", async () => {
    const first = await post("/api/ledger/places", { name: "Assaí" });
    expect(first.statusCode).toBe(201);
    const list = await app.inject("/api/ledger/places?search=ASSAI").then((r) => r.json());
    expect(list).toHaveLength(1);
  });

  // O formulário de lançamento cria o local pelo nome digitado: um nome que já
  // existe derrubava o lançamento com "Erro interno".
  it("criar local ou etiqueta com nome existente devolve o existente", async () => {
    const first = (await post("/api/ledger/places", { name: "Assaí" })).json();
    const again = await post("/api/ledger/places", { name: " ASSAÍ " });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.id);

    const tag = (await post("/api/ledger/tags", { name: "Viagem", color: "#ff0000" })).json();
    const tagAgain = await post("/api/ledger/tags", { name: "viagem", color: "#00ff00" });
    expect(tagAgain.statusCode).toBe(200);
    expect(tagAgain.json().id).toBe(tag.id);
  });
});

describe("lancamentos", () => {
  it("cria e lista, devolvendo saldo atualizado numa ida so", async () => {
    const created = await post("/api/ledger/entries", baseExpense());
    expect(created.statusCode).toBe(201);
    expect(created.json().balances.consolidatedCents).toBe(55_00);

    const list = await app.inject("/api/ledger/entries").then((r) => r.json());
    expect(list.total).toBe(1);
    expect(list.rows[0].categoryName).toBe("Mercado");
    expect(list.rows[0].accountName).toBe("Nubank");
    expect(list.rows[0].personName).toBe("Steylor");
  });

  it("filtra por periodo", async () => {
    await post("/api/ledger/entries", baseExpense());
    await post("/api/ledger/entries", { ...baseExpense(), date: "2026-05-10" });

    const march = await app
      .inject("/api/ledger/entries?from=2026-03-01&to=2026-03-31")
      .then((r) => r.json());
    expect(march.total).toBe(1);
    expect(march.totals.expenseCents).toBe(-4500);
  });

  it("filtra por categoria aceitando a chave repetida", async () => {
    await post("/api/ledger/entries", baseExpense());
    const salario = (
      await app.inject("/api/ledger/categories?kind=income").then((r) => r.json())
    ).find((c: { name: string }) => c.name === "Salário").id;
    await post("/api/ledger/entries", {
      accountId: checking,
      date: "2026-03-05",
      amountCents: 500_000,
      kind: "income",
      categoryId: salario
    });

    const filtered = await app
      .inject(`/api/ledger/entries?categoryId=${mercado}`)
      .then((r) => r.json());
    expect(filtered.total).toBe(1);

    const both = await app
      .inject(`/api/ledger/entries?categoryId=${mercado}&categoryId=${salario}`)
      .then((r) => r.json());
    expect(both.total).toBe(2);
  });

  it("rejeita saida com valor positivo e categoria em transferencia", async () => {
    const positive = await post("/api/ledger/entries", { ...baseExpense(), amountCents: 4500 });
    expect(positive.statusCode).toBe(400);

    const categorized = await post("/api/ledger/entries", {
      ...baseExpense(),
      kind: "transfer",
      categoryId: mercado
    });
    expect(categorized.statusCode).toBe(400);
  });

  it("devolve 404 em id inexistente", async () => {
    expect((await app.inject("/api/ledger/entries/999")).statusCode).toBe(404);
    expect(
      (await app.inject({ method: "DELETE", url: "/api/ledger/entries/999" })).statusCode
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/ledger/entries/999",
          payload: baseExpense()
        })
      ).statusCode
    ).toBe(404);
  });

  it("altera status em lote", async () => {
    const id = (await post("/api/ledger/entries", { ...baseExpense(), status: "pending" })).json()
      .id;
    const response = await post("/api/ledger/entries/status", {
      ids: [id],
      status: "cleared"
    });
    expect(response.json().changed).toBe(1);
    expect(response.json().balances.consolidatedCents).toBe(55_00);
  });
});

describe("transferencias", () => {
  it("cria duas linhas e nao mexe no consolidado (D21)", async () => {
    const response = await post("/api/ledger/transfers", {
      fromAccountId: checking,
      toAccountId: savings,
      date: "2026-03-10",
      amountCents: 3000
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().balances.consolidatedCents).toBe(100_00);

    const list = await app.inject("/api/ledger/entries").then((r) => r.json());
    expect(list.total).toBe(2);
    expect(list.rows.every((row: { categoryId: number | null }) => row.categoryId === null)).toBe(
      true
    );
  });

  it("rejeita origem igual a destino", async () => {
    const response = await post("/api/ledger/transfers", {
      fromAccountId: checking,
      toAccountId: checking,
      date: "2026-03-10",
      amountCents: 3000
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("exportacao", () => {
  it("exporta o livro em CSV respeitando o filtro da tela", async () => {
    await post("/api/ledger/entries", { ...baseExpense(), description: "Compra" });
    await post("/api/ledger/entries", { ...baseExpense(), date: "2026-05-01" });

    const response = await app.inject("/api/ledger/export.csv?from=2026-03-01&to=2026-03-31");
    expect(response.headers["content-type"]).toContain("text/csv");
    const lines = response.body.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("data,tipo,valor");
    expect(lines[1]).toContain("-45.00");
    expect(lines[1]).toContain("Compra");
  });

  it("inclui o livro no export JSON completo", async () => {
    await post("/api/ledger/entries", baseExpense());
    const payload = await app.inject("/api/export").then((r) => r.json());
    expect(payload.ledger.entries).toHaveLength(1);
    expect(
      payload.ledger.accounts.filter((a: { kind: string }) => a.kind !== "investment")
    ).toHaveLength(2);
  });
});

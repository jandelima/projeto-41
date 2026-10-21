import { readFileSync } from "node:fs";
import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const NUBANK_CSV = readFileSync(
  new URL("../import/__fixtures__/csv/nubank-conta.csv", import.meta.url)
);

let db: AppDatabase;
let app: ReturnType<typeof buildApp>;
let accountId: number;

/** Corpo multipart montado a mao: `app.inject` nao tem FormData. */
function multipart(fields: Record<string, string>, file: { name: string; content: Buffer }) {
  const boundary = "----projeto41test";
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        "Content-Type: text/csv\r\n\r\n"
    ),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
  };
}

beforeEach(async () => {
  db = createTestDatabase();
  app = buildApp({ db, priceService: { runAll: async () => [] } });
  await app.ready();
  accountId = db.ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: db.ledger.people.list()[0]!.id,
    openingBalanceCents: 0
  });
});

afterEach(async () => {
  await app.close();
});

describe("rotas de importacao de extrato", () => {
  it("sobe o CSV, confirma uma linha e devolve o saldo", async () => {
    const upload = await app.inject({
      method: "POST",
      url: "/api/ledger/imports",
      ...multipart({ accountId: String(accountId), kind: "bank" }, { name: "NU.csv", content: NUBANK_CSV })
    });
    expect(upload.statusCode).toBe(201);
    const view = upload.json();
    expect(view.counts.review).toBe(58);

    const first = view.rows[0];
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/ledger/imports/${view.batch.id}/rows/${first.id}/confirm`,
      payload: { action: "create", kind: "expense", description: "Remedio", remember: "auto" }
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().counts.committed).toBe(1);
    expect(confirmed.json().balances).toBeDefined();

    const again = await app.inject({
      method: "POST",
      url: `/api/ledger/imports/${view.batch.id}/rows/${first.id}/confirm`,
      payload: { action: "create", kind: "expense" }
    });
    expect(again.statusCode).toBe(409);

    const list = await app.inject("/api/ledger/imports");
    expect(list.json()[0]).toMatchObject({ id: view.batch.id, accountName: "Nubank" });
  });

  it("recusa upload sem conta", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ledger/imports",
      ...multipart({ kind: "bank" }, { name: "NU.csv", content: NUBANK_CSV })
    });
    expect(response.statusCode).toBe(400);
  });

  it("exige que o usuario diga se e extrato ou fatura", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ledger/imports",
      ...multipart({ accountId: String(accountId) }, { name: "NU.csv", content: NUBANK_CSV })
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/extrato da conta ou a fatura do cart/);
  });

  it("recusa fatura enviada como extrato", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ledger/imports",
      ...multipart(
        { accountId: String(accountId), kind: "card" },
        { name: "NU.csv", content: NUBANK_CSV }
      )
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/cart/);
  });
});

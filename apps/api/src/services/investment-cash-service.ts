import type { Operation } from "@projeto41/contracts";
import { investmentSettingKey, type AppDatabase, type PositionMovementKind } from "@projeto41/db";
import { toCents } from "@projeto41/finance";

/**
 * O dinheiro entre o banco e os investimentos (migração 010).
 *
 *     conta bancária ──aporte──▶ posição (caixa, renda fixa…) ──compra──▶ carteira
 *     conta bancária ◀─resgate── posição                      ◀──venda─── carteira
 *
 * As posições de "Caixa e renda fixa" são os caixas: o usuário aporta num
 * deles, decide depois para onde vai (mover para a renda fixa, comprar cripto)
 * e resgata de volta quando quiser. Tudo que atravessa para o banco vira uma
 * transferência do livro contra a conta-ponte "Investimentos", que fica fora
 * do patrimônio — o dinheiro já está no valor das posições.
 *
 * **Esta é a única fronteira entre o `REAL` do módulo de investimentos e os
 * centavos do livro.** `toLedgerCents` e `convert` são os pontos de passagem,
 * e a cotação usada fica registrada na nota para o número ser auditável.
 */

export class ReconciledLinkError extends Error {
  statusCode = 409;

  constructor() {
    super(
      "Operacao vinculada a um lancamento ja conciliado. Desvincule antes de excluir."
    );
    this.name = "ReconciledLinkError";
  }
}

const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

export type CashSettings = {
  /** Registrar operação movimenta dinheiro. Desligado, a operação é só registro. */
  autoDebit: boolean;
  /** Conta bancária que paga direto, sem passar por caixa. */
  defaultAccountId: number | null;
  /** Caixa que paga por padrão. Tem precedência sobre a conta. */
  defaultPositionId: number | null;
};

const readNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/** Cada conta de investimento tem a própria forma de pagar. */
export function readCashSettings(db: AppDatabase): CashSettings {
  const positionId = readNumber(db.settings.get(investmentSettingKey("investment.default_position_id")));
  return {
    autoDebit: (db.settings.get(investmentSettingKey("investment.auto_debit")) ?? "1") === "1",
    defaultAccountId: readNumber(db.settings.get(investmentSettingKey("investment.default_account_id"))),
    // Um caixa apagado não pode continuar sendo o padrão.
    defaultPositionId: positionId != null && db.positions.get(positionId) ? positionId : null
  };
}

export function writeCashSettings(db: AppDatabase, settings: CashSettings) {
  db.settings.set(investmentSettingKey("investment.auto_debit"), settings.autoDebit ? "1" : "0");
  db.settings.set(
    investmentSettingKey("investment.default_account_id"),
    settings.defaultAccountId == null ? "" : String(settings.defaultAccountId)
  );
  db.settings.set(
    investmentSettingKey("investment.default_position_id"),
    settings.defaultPositionId == null ? "" : String(settings.defaultPositionId)
  );
}

/** A conta-ponte do livro. A 010 garante que ela existe. */
export function bridgeAccountId(db: AppDatabase): number {
  const id =
    readNumber(db.settings.get("investment.bridge_account_id")) ??
    readNumber(db.settings.get("investment.crypto_account_id"));
  if (id == null) throw fail("Conta-ponte de investimentos nao configurada", 500);
  return id;
}

export type LedgerAmount = { cents: number; note: string | null };

function usdBrl(db: AppDatabase): number {
  return db.prices.get("USDBRL")?.price ?? 0;
}

/**
 * Converte o total da operação para centavos de BRL.
 *
 * Operação em USD sem cotação **lança**: é melhor recusar do que gravar um
 * débito errado que o usuário só descobriria conferindo o extrato.
 */
export function toLedgerCents(db: AppDatabase, operation: Operation): LedgerAmount {
  if (operation.currency !== "USD") {
    return { cents: toCents(operation.total), note: null };
  }
  const rate = usdBrl(db);
  if (!rate) throw fail("Sem cotacao do dolar para converter a operacao em USD");
  return {
    cents: toCents(operation.total * rate),
    note: `USDBRL ${rate.toFixed(4).replace(".", ",")} em ${operation.date}`
  };
}

/** Converte um valor entre BRL e USD pela cotação do momento. */
function convert(db: AppDatabase, amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const rate = usdBrl(db);
  if (!rate) throw fail("Sem cotacao do dolar para converter entre reais e dolares");
  const converted = from === "USD" ? amount * rate : amount / rate;
  return Math.round(converted * 100) / 100;
}

/** Renda fixa e ações globais acompanham o investido; caixa só tem saldo. */
const tracksInvested = (category: string) => category === "fixed_income" || category === "global";

function positionOrFail(db: AppDatabase, id: number) {
  const position = db.positions.get(id);
  if (!position) throw fail("Posicao nao encontrada", 404);
  return position;
}

const brl = (value: number) => value.toFixed(2).replace(".", ",");

/**
 * Tira `amount` (na moeda da posição) do valor atual. O investido cai na mesma
 * proporção: resgatar metade de um CDB leva metade do que foi investido nele.
 */
function outflow(db: AppDatabase, positionId: number, amount: number) {
  const position = positionOrFail(db, positionId);
  if (amount > position.currentValue + 0.005) {
    throw fail(`${position.name} tem ${brl(position.currentValue)}: nao cobre ${brl(amount)}`);
  }
  const investedDelta =
    tracksInvested(position.category) && position.currentValue > 0
      ? -Math.round(position.invested * (amount / position.currentValue) * 100) / 100
      : 0;
  db.positions.applyDelta(positionId, -amount, investedDelta);
  return { position, investedDelta };
}

function inflow(db: AppDatabase, positionId: number, amount: number) {
  const position = positionOrFail(db, positionId);
  const investedDelta = tracksInvested(position.category) ? amount : 0;
  db.positions.applyDelta(positionId, amount, investedDelta);
  return { position, investedDelta };
}

function record(
  db: AppDatabase,
  row: {
    positionId: number;
    date: string;
    kind: PositionMovementKind;
    amount: number;
    investedDelta: number;
    transferId?: number | null;
    operationId?: number | null;
    description: string;
  }
) {
  return db.positionMovements.create({
    positionId: row.positionId,
    date: row.date,
    kind: row.kind,
    amount: row.amount,
    investedDelta: row.investedDelta,
    transferId: row.transferId ?? null,
    operationId: row.operationId ?? null,
    pairId: null,
    description: row.description
  });
}

function transferEnds(db: AppDatabase, transferId: number) {
  return db.raw
    .prepare(
      `SELECT from_entry_id AS fromEntryId, to_entry_id AS toEntryId FROM transfers WHERE id = ?`
    )
    .get(transferId) as { fromEntryId: number; toEntryId: number } | undefined;
}

function assertTransferNotReconciled(db: AppDatabase, transferId: number) {
  const ends = transferEnds(db, transferId);
  if (!ends) return;
  for (const entryId of [ends.fromEntryId, ends.toEntryId]) {
    if (db.ledger.entries.get(entryId)?.status === "reconciled") throw new ReconciledLinkError();
  }
}

/** Devolve a posição ao que era antes do movimento e apaga o movimento. */
function reverse(db: AppDatabase, movementId: number) {
  const movement = db.positionMovements.get(movementId);
  if (!movement) return;
  db.positions.applyDelta(movement.positionId, -movement.amount, -movement.investedDelta);
  db.positionMovements.remove(movement.id);
}

/** Apaga a transferência do livro que um movimento criou. */
function removeTransfer(db: AppDatabase, transferId: number) {
  const ends = transferEnds(db, transferId);
  if (ends) db.ledger.entries.remove(ends.fromEntryId);
}

// --- Aporte, resgate e movimento entre posições ------------------------------

export type DepositInput = {
  positionId: number;
  fromAccountId: number;
  /** Sempre em reais: é o que sai da conta bancária. */
  amountCents: number;
  date: string;
  /**
   * Saída lançada como gasto que na verdade foi aporte: sai do livro no mesmo
   * passo em que o aporte entra, para o dinheiro não sair da conta duas vezes.
   */
  replacesEntryId?: number | null;
};

/** O gasto que vira aporte precisa ser uma saída comum da mesma conta. */
function assertReplaceable(db: AppDatabase, entryId: number, fromAccountId: number) {
  const entry = db.ledger.entries.get(entryId);
  if (!entry) throw fail("Lancamento a substituir nao encontrado", 404);
  if (entry.kind !== "expense") throw fail("So uma saida pode virar aporte");
  if (entry.accountId !== fromAccountId) {
    throw fail("O aporte precisa sair da mesma conta do lancamento que ele substitui");
  }
  if (entry.installmentPlanId != null || entry.refundOfEntryId != null) {
    throw fail("Parcela ou estorno nao vira aporte");
  }
}

export function depositToPosition(db: AppDatabase, input: DepositInput) {
  return db.transaction(() => {
    if (input.replacesEntryId != null) {
      assertReplaceable(db, input.replacesEntryId, input.fromAccountId);
      db.ledger.entries.remove(input.replacesEntryId);
    }
    const position = positionOrFail(db, input.positionId);
    const amount = convert(db, input.amountCents / 100, "BRL", position.currency);
    const { fromEntryId } = db.ledger.entries.createTransfer({
      fromAccountId: input.fromAccountId,
      toAccountId: bridgeAccountId(db),
      date: input.date,
      amountCents: input.amountCents,
      purpose: "investment",
      status: "cleared",
      description: `Aporte · ${position.name}`
    });
    const transferId = db.ledger.entries.get(fromEntryId)?.transferId ?? null;
    const { investedDelta } = inflow(db, position.id, amount);
    return {
      movementId: record(db, {
        positionId: position.id,
        date: input.date,
        kind: "deposit",
        amount,
        investedDelta,
        transferId,
        description: `Aporte · ${position.name}`
      })
    };
  });
}

export type WithdrawInput = {
  positionId: number;
  toAccountId: number;
  /** Em reais, o que chega na conta. */
  amountCents: number;
  date: string;
};

export function withdrawFromPosition(db: AppDatabase, input: WithdrawInput) {
  return db.transaction(() => {
    const position = positionOrFail(db, input.positionId);
    const amount = convert(db, input.amountCents / 100, "BRL", position.currency);
    const { investedDelta } = outflow(db, position.id, amount);
    const { fromEntryId } = db.ledger.entries.createTransfer({
      fromAccountId: bridgeAccountId(db),
      toAccountId: input.toAccountId,
      date: input.date,
      amountCents: input.amountCents,
      purpose: "investment",
      status: "cleared",
      description: `Resgate · ${position.name}`
    });
    const transferId = db.ledger.entries.get(fromEntryId)?.transferId ?? null;
    return {
      movementId: record(db, {
        positionId: position.id,
        date: input.date,
        kind: "withdrawal",
        amount: -amount,
        investedDelta,
        transferId,
        description: `Resgate · ${position.name}`
      })
    };
  });
}

export type MoveInput = {
  fromPositionId: number;
  toPositionId: number;
  /** Na moeda da posição de origem. */
  amount: number;
  date: string;
};

/** De uma posição para outra, sem passar pelo banco: é o "alocar" do caixa. */
export function moveBetweenPositions(db: AppDatabase, input: MoveInput) {
  if (input.fromPositionId === input.toPositionId) {
    throw fail("Origem e destino precisam ser posicoes diferentes");
  }
  return db.transaction(() => {
    const out = outflow(db, input.fromPositionId, input.amount);
    const target = positionOrFail(db, input.toPositionId);
    const received = convert(db, input.amount, out.position.currency, target.currency);
    const inn = inflow(db, target.id, received);
    const outId = record(db, {
      positionId: out.position.id,
      date: input.date,
      kind: "move_out",
      amount: -input.amount,
      investedDelta: out.investedDelta,
      description: `Para ${target.name}`
    });
    const inId = record(db, {
      positionId: target.id,
      date: input.date,
      kind: "move_in",
      amount: received,
      investedDelta: inn.investedDelta,
      description: `De ${out.position.name}`
    });
    db.positionMovements.setPair(outId, inId);
    db.positionMovements.setPair(inId, outId);
    return { movementId: outId };
  });
}

/**
 * Desfaz aporte, resgate ou movimento. Compra e venda se desfazem pela
 * operação: o movimento é dela.
 */
export function undoMovement(db: AppDatabase, movementId: number) {
  return db.transaction(() => {
    const movement = db.positionMovements.get(movementId);
    if (!movement) throw fail("Movimento nao encontrado", 404);
    if (movement.operationId != null) {
      throw fail("Compra e venda se desfazem pela operacao, na carteira");
    }
    if (movement.transferId != null) assertTransferNotReconciled(db, movement.transferId);
    const pair = movement.pairId;
    reverse(db, movement.id);
    if (pair != null) reverse(db, pair);
    // A ponta do livro sai depois do movimento: enquanto ele existe, o livro
    // recusa apagar a transferência sozinha.
    if (movement.transferId != null) removeTransfer(db, movement.transferId);
    return { ok: true as const };
  });
}

/** Posição com dinheiro do banco ou de operação não some sem desfazer antes. */
export function removePosition(db: AppDatabase, id: number) {
  if (db.positionMovements.countLinked(id) > 0) {
    throw fail(
      "Esta posicao tem aportes, resgates ou operacoes. Resgate ou desfaca os movimentos antes de excluir.",
      409
    );
  }
  return db.transaction(() => {
    // Só sobram movimentos entre posições: desfazer devolve a outra ponta.
    for (const movement of db.positionMovements.list({ positionId: id, limit: 10_000 })) {
      if (!db.positionMovements.get(movement.id)) continue;
      const pair = movement.pairId;
      reverse(db, movement.id);
      if (pair != null) reverse(db, pair);
    }
    db.positions.remove(id);
  });
}

// --- Operações ----------------------------------------------------------------

function describe(operation: Operation): string {
  const verb = operation.type === "buy" ? "Compra" : "Venda";
  const quantity = operation.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 8 });
  return `${verb} ${operation.asset} ${quantity}`;
}

type OperationInput = Operation & { accountId?: number | null; positionId?: number | null };

/** O que vai para a tabela `operations`: o caixa mora no movimento, não nela. */
function stored(input: OperationInput): Operation & { accountId: number | null } {
  return {
    portfolio: input.portfolio,
    type: input.type,
    asset: input.asset,
    date: input.date,
    quantity: input.quantity,
    total: input.total,
    currency: input.currency,
    notes: input.notes,
    accountId: input.positionId != null ? null : (input.accountId ?? null)
  };
}

/**
 * Cria o movimento de dinheiro da operação. Com caixa: a posição paga a compra
 * (ou recebe a venda) na moeda dela. Com conta: transferência direta entre o
 * banco e a ponte, sem passar por caixa.
 */
function createCashLegs(
  db: AppDatabase,
  operationId: number,
  input: OperationInput,
  /** Valor já debitado no banco, mantido numa edição que não mexeu no dinheiro. */
  keep: LedgerAmount | null = null
) {
  const buying = input.type === "buy";
  if (input.positionId != null) {
    const position = positionOrFail(db, input.positionId);
    const amount = convert(db, input.total, input.currency, position.currency);
    const change = buying ? outflow(db, position.id, amount) : inflow(db, position.id, amount);
    record(db, {
      positionId: position.id,
      date: input.date,
      kind: buying ? "buy" : "sell",
      amount: buying ? -amount : amount,
      investedDelta: change.investedDelta,
      operationId,
      description: describe(input)
    });
    return { transferId: null };
  }
  if (input.accountId == null) return { transferId: null };

  const amount = keep ?? toLedgerCents(db, input);
  const bridge = bridgeAccountId(db);
  const { fromEntryId } = db.ledger.entries.createTransfer({
    fromAccountId: buying ? input.accountId : bridge,
    toAccountId: buying ? bridge : input.accountId,
    date: input.date,
    amountCents: amount.cents,
    // Transferência para investimento nunca conta no alvo de gastos: é
    // justamente para sobrar dinheiro para investir que o alvo existe (6.4).
    purpose: "investment",
    status: "cleared",
    description: describe(input),
    notes: amount.note
  });
  const transferId = db.ledger.entries.get(fromEntryId)?.transferId ?? null;
  if (transferId != null) db.operationLinks.set(operationId, transferId);
  return { transferId };
}

/** Desfaz o movimento de dinheiro da operação, seja pelo caixa ou pelo banco. */
function removeCashLegs(db: AppDatabase, operationId: number): boolean {
  const link = db.operationLinks.get(operationId);
  if (link) assertTransferNotReconciled(db, link.transferId);
  const movement = db.positionMovements.byOperation(operationId);
  if (link) {
    db.operationLinks.remove(operationId);
    removeTransfer(db, link.transferId);
  }
  if (movement) reverse(db, movement.id);
  return Boolean(link || movement);
}

export function registerOperation(
  db: AppDatabase,
  input: OperationInput
): { id: number; transferId: number | null } {
  // Tudo numa transação só: nunca sobra operação sem movimento nem movimento
  // sem operação.
  return db.transaction(() => {
    const settings = readCashSettings(db);
    const id = db.operations.create(stored(input));
    // Escolher um caixa é sempre movimentar; a conta depende do débito ligado.
    const moves = input.positionId != null || (settings.autoDebit && input.accountId != null);
    if (!moves) return { id, transferId: null };
    return { id, transferId: createCashLegs(db, id, input).transferId };
  });
}

/**
 * Editar refaz o movimento do zero: desfazer e registrar de novo dá o mesmo
 * resultado que registrar a operação já editada, com três caminhos possíveis
 * (caixa, conta, nenhum) sem remendo ponta a ponta.
 */
export function updateOperation(
  db: AppDatabase,
  id: number,
  input: OperationInput
): { transferId: number | null } {
  return db.transaction(() => {
    const settings = readCashSettings(db);
    // Editar só a nota (ou a quantidade) de uma compra em dólar não pode mudar
    // o que saiu do banco: o débito foi feito na cotação daquele dia. O valor em
    // reais só é recalculado quando o dinheiro da operação muda.
    const before = db.operations.list().find((operation) => operation.id === id);
    const link = db.operationLinks.get(id);
    const ledgerBefore =
      link != null
        ? (db.raw
            .prepare(
              `SELECT ABS(e.amount_cents) AS cents, e.notes AS note FROM transfers t
               JOIN entries e ON e.id = t.from_entry_id WHERE t.id = ?`
            )
            .get(link.transferId) as { cents: number; note: string | null } | undefined)
        : undefined;
    const sameMoney =
      before != null &&
      ledgerBefore != null &&
      input.positionId == null &&
      before.total === input.total &&
      before.currency === input.currency &&
      before.type === input.type &&
      before.accountId === (input.accountId ?? null);
    const keep = sameMoney ? { cents: ledgerBefore.cents, note: ledgerBefore.note } : null;
    // Converter antes de desfazer: sem cotação, nada muda.
    if (!keep && input.accountId != null && input.positionId == null) toLedgerCents(db, input);
    const hadLegs = removeCashLegs(db, id);
    db.operations.update(id, stored(input));
    const moves =
      input.positionId != null || (input.accountId != null && (hadLegs || settings.autoDebit));
    if (!moves) return { transferId: null };
    return { transferId: createCashLegs(db, id, input, keep).transferId };
  });
}

/** Desfaz o movimento de dinheiro, mantendo a operação. */
export function unlinkOperation(db: AppDatabase, id: number) {
  return db.transaction(() => {
    removeCashLegs(db, id);
    db.raw.prepare("UPDATE operations SET account_id = NULL WHERE id = ?").run(id);
    return { ok: true as const };
  });
}

export function removeOperation(db: AppDatabase, id: number) {
  return db.transaction(() => {
    // Recusar é a única saída aceitável: deixar lançamento órfão ou apagar
    // lançamento conciliado são as duas piores alternativas.
    removeCashLegs(db, id);
    db.operations.remove(id);
    return { ok: true as const };
  });
}

/** Lista as operações já com a origem do dinheiro, para a interface não adivinhar. */
export function listOperationsWithLinks(db: AppDatabase, portfolio?: "crypto" | "b3") {
  const operations = db.operations.list(portfolio);
  const links = db.operationLinks.listByOperations(operations.map((operation) => operation.id));
  const byOperation = new Map(links.map((link) => [link.operationId, link]));
  const movements = new Map(
    (
      db.raw
        .prepare(
          `SELECT m.operation_id AS operationId, m.position_id AS positionId, p.name
           FROM position_movements m JOIN manual_positions p ON p.id = m.position_id
           WHERE m.operation_id IS NOT NULL`
        )
        .all() as { operationId: number; positionId: number; name: string }[]
    ).map((row) => [row.operationId, row])
  );
  // O que saiu (ou entrou) no banco, em reais: é o número que o usuário
  // digitou e confere no extrato, mesmo com a operação guardada em USD.
  const ledgerCents = new Map(
    (
      db.raw
        .prepare(
          `SELECT t.id AS transferId, ABS(e.amount_cents) AS cents
           FROM transfers t JOIN entries e ON e.id = t.from_entry_id`
        )
        .all() as { transferId: number; cents: number }[]
    ).map((row) => [row.transferId, row.cents])
  );
  const names = new Map(
    (db.raw.prepare("SELECT id, name FROM accounts").all() as { id: number; name: string }[]).map(
      (row) => [row.id, row.name]
    )
  );
  return operations.map((operation) => {
    const link = byOperation.get(operation.id);
    const movement = movements.get(operation.id);
    return {
      ...operation,
      positionId: movement?.positionId ?? null,
      // De onde saiu (ou para onde foi) o dinheiro: a conta bancária ou o caixa.
      accountName: movement
        ? movement.name
        : link && operation.accountId != null
          ? (names.get(operation.accountId) ?? null)
          : null,
      transferId: link?.transferId ?? null,
      ledgerCents: link ? (ledgerCents.get(link.transferId) ?? null) : null,
      transferStatus: link?.transferStatus ?? null,
      cashSource: movement ? ("position" as const) : link ? ("bank" as const) : null
    };
  });
}

/** Limpar a carteira inteira: recusa se qualquer operação tiver ponta conciliada. */
export function clearOperations(db: AppDatabase, portfolio?: "crypto" | "b3") {
  const operations = db.operations.list(portfolio);
  const links = db.operationLinks.listByOperations(operations.map((operation) => operation.id));
  const blocked = links.filter((link) => link.transferStatus === "reconciled");
  if (blocked.length > 0) {
    throw fail(
      `${blocked.length} operacao(oes) estao vinculadas a lancamentos ja conciliados. ` +
        "Desvincule antes de limpar a carteira.",
      409
    );
  }
  return db.transaction(() => {
    for (const operation of operations) removeOperation(db, operation.id);
    return operations.length;
  });
}

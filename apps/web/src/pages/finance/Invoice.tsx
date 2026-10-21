import {
  CreditCard,
  FastForward,
  ListTree,
  Receipt,
  RotateCcw,
  Search,
  Undo2,
  Wallet
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AccountRecord,
  CardSummary,
  EntryRecord,
  StatementSummary
} from "@projeto41/contracts";
import { fromCents } from "@projeto41/finance";
import { AreaTrend } from "../../components/charts.js";
import { ColorDot } from "../../components/ColorPicker.js";
import { useConfirm } from "../../components/dialog.js";
import { AnticipateDrawer } from "../../components/finance/AnticipateDrawer.js";
import { CardLimit } from "../../components/finance/CardLimit.js";
import { EntryDrawer } from "../../components/finance/EntryDrawer.js";
import { InstallmentBadge } from "../../components/finance/InstallmentBadge.js";
import { InvoicePaymentDrawer } from "../../components/finance/InvoicePaymentDrawer.js";
import { StatementNav } from "../../components/finance/StatementNav.js";
import {
  AnimatedNumber,
  Button,
  Empty,
  IconButton,
  Loading,
  Panel,
  SectionHeading,
  Segmented,
  Stat
} from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { ledgerDate, monthLabel, moneyFromCents } from "../../lib/format.js";
import { useLedgerReference } from "../../lib/ledger.js";
import type { FinanceNavigate } from "../../lib/navigation.js";
import { useToast } from "../../lib/toast.js";

type StatementDetail = {
  month: string;
  closingDate: string;
  dueDate: string;
  purchases: EntryRecord[];
  payments: EntryRecord[];
  /** Compras fora da fatura natural (a da série, na parcela). Vem do servidor. */
  anticipatedIds: number[];
  purchasesCents: number;
  paymentsCents: number;
  totalCents: number;
};

export function InvoicePage({ onNavigate }: { onNavigate?: FinanceNavigate }) {
  const toast = useToast();
  const reference = useLedgerReference();
  // A compra aberta para editar, sem sair da fatura.
  const [editing, setEditing] = useState<EntryRecord | null>(null);
  const confirm = useConfirm();
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [cardId, setCardId] = useState<number | null>(null);
  const [statements, setStatements] = useState<StatementSummary[]>([]);
  const [month, setMonth] = useState<string | null>(null);
  const [detail, setDetail] = useState<StatementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [anticipating, setAnticipating] = useState(false);
  const [futureInstallments, setFutureInstallments] = useState<EntryRecord[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [nextCards, nextAccounts] = await Promise.all([
          api<CardSummary[]>("/ledger/cards"),
          api<AccountRecord[]>("/ledger/accounts")
        ]);
        setCards(nextCards);
        setAccounts(nextAccounts);
        setCardId((current) => current ?? nextCards[0]?.id ?? null);
      } catch (error) {
        toast.notify(error instanceof Error ? error.message : "Falha ao carregar", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const loadStatements = useCallback(async () => {
    if (cardId == null) return;
    const list = await api<StatementSummary[]>(`/ledger/cards/${cardId}/statements`);
    setStatements(list);
    setMonth((current) => {
      if (current && list.some((statement) => statement.month === current)) return current;
      const card = cards.find((item) => item.id === cardId);
      return card?.currentStatementMonth ?? list[list.length - 1]?.month ?? null;
    });
  }, [cardId, cards]);

  useEffect(() => {
    void loadStatements().catch(() => undefined);
  }, [loadStatements]);

  const loadDetail = useCallback(async () => {
    if (cardId == null || !month) return;
    setDetail(await api<StatementDetail>(`/ledger/cards/${cardId}/statements/${month}`));
  }, [cardId, month]);

  useEffect(() => {
    void loadDetail().catch(() => undefined);
  }, [loadDetail]);

  // As parcelas ainda pendentes são as candidatas a antecipar.
  useEffect(() => {
    if (cardId == null) return;
    void api<{ rows: EntryRecord[] }>(
      `/ledger/entries?accountId=${cardId}&status=pending&pageSize=200`
    )
      .then((result) =>
        setFutureInstallments(result.rows.filter((row) => row.installmentPlanId != null))
      )
      .catch(() => setFutureInstallments([]));
  }, [cardId, detail]);

  async function refreshAll() {
    const nextCards = await api<CardSummary[]>("/ledger/cards");
    setCards(nextCards);
    await loadStatements();
    await loadDetail();
  }

  /** Abre o lançamento no livro, no dia dele e só neste cartão. */
  const showInLedger = (entry: EntryRecord) =>
    onNavigate?.("transactions", { accountId: entry.accountId, from: entry.date, to: entry.date });
  /** Todas as parcelas da compra, passadas e futuras, de uma vez. */
  const showPlanInLedger = (entry: EntryRecord) =>
    onNavigate?.("transactions", {
      accountId: entry.accountId,
      installmentPlanId: entry.installmentPlanId ?? undefined,
      allTime: true
    });

  const card = cards.find((item) => item.id === cardId);
  const active = statements.find((statement) => statement.month === month);

  /** Últimas 12 faturas, para a evolução. Centavos → reais só aqui. */
  const trend = useMemo(
    () =>
      statements.slice(-12).map((statement) => ({
        date: `${statement.month}-01`,
        value: fromCents(statement.totalCents),
        isFuture: statement.isFuture
      })),
    [statements]
  );

  /**
   * Uma parcela está antecipada quando o mês gravado difere do natural. O
   * natural da parcela é o da série, não o da data dela, e quem sabe a série é
   * o servidor: recalcular aqui pela data marcava parcelas comuns.
   */
  const anticipatedIds = useMemo(() => new Set(detail?.anticipatedIds ?? []), [detail]);

  async function restore(entryId: number) {
    if (!card) return;
    await api(`/ledger/cards/${card.id}/anticipate/undo`, {
      method: "POST",
      body: JSON.stringify({ entryIds: [entryId] })
    });
    toast.notify("Parcela devolvida à fatura original");
    await refreshAll();
  }

  async function undoPayment(entry: EntryRecord) {
    if (!card || !month || entry.transferId == null) return;
    const ok = await confirm({
      title: "Desfazer pagamento",
      message: "As duas pontas da transferência serão removidas e a fatura volta a ficar em aberto.",
      confirmLabel: "Desfazer",
      tone: "danger"
    });
    if (!ok) return;
    await api(
      `/ledger/cards/${card.id}/statements/${month}/payment/${entry.transferId}`,
      { method: "DELETE" }
    );
    toast.notify("Pagamento desfeito");
    await refreshAll();
  }

  if (loading) return <Loading />;

  if (cards.length === 0) {
    return (
      <>
        <SectionHeading title="Fatura" subtitle="Cartões de crédito" />
        <Empty icon={CreditCard} text="Nenhum cartão cadastrado. Crie um em Contas." />
      </>
    );
  }

  return (
    <>
      <SectionHeading title="Fatura" subtitle={card?.name ?? ""}>
        {futureInstallments.length > 0 && (
          <Button variant="ghost" icon={FastForward} onClick={() => setAnticipating(true)}>
            Antecipar parcelas
          </Button>
        )}
        {active && active.totalCents > 0 && (
          <Button icon={Wallet} onClick={() => setPaying(true)}>
            Pagar fatura
          </Button>
        )}
      </SectionHeading>

      {cards.length > 1 && (
        <Panel bodyClass="fin-filter-body">
          <Segmented<string>
            value={String(cardId)}
            onChange={(value) => setCardId(Number(value))}
            options={cards.map((item) => ({ value: String(item.id), label: item.name }))}
          />
        </Panel>
      )}

      {card && (
        <>
          <div className="fin-summary">
            {/* Dois números, nunca um só (6.1). A linha abaixo explica por que
                eles não batem — senão o usuário acha que um está errado. */}
            <Stat
              icon={Receipt}
              label="Fatura atual"
              value={
                <AnimatedNumber
                  value={card.currentStatementCents / 100}
                  format={(value) => moneyFromCents(value * 100)}
                />
              }
              detail={`vence em ${ledgerDate(card.dueDate)}`}
            />
            <Stat
              icon={CreditCard}
              label="Total devido"
              value={
                <AnimatedNumber
                  value={card.totalOwedCents / 100}
                  format={(value) => moneyFromCents(value * 100)}
                />
              }
              detail="inclui parcelas futuras já lançadas"
            />
          </div>

          <Panel title="Limite">
            <CardLimit card={card} />
          </Panel>
        </>
      )}

      <Panel bodyClass="fin-filter-body">
        <StatementNav
          statements={statements}
          current={month ?? ""}
          onChange={(next) => setMonth(next)}
        />
      </Panel>

      {detail && (
        <Panel
          title={`Compras de ${monthLabel(detail.month)}`}
          subtitle={`fechamento ${ledgerDate(detail.closingDate)} · vencimento ${ledgerDate(
            detail.dueDate
          )}`}
        >
          {detail.purchases.length === 0 ? (
            <Empty icon={Receipt} text="Nenhuma compra nesta fatura." />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Categoria</th>
                    <th>Pessoa</th>
                    <th className="num">Valor</th>
                    <th aria-label="Ir para" />
                  </tr>
                </thead>
                <tbody>
                  {detail.purchases.map((entry) => (
                    <tr
                      key={entry.id}
                      className="fin-row-click"
                      tabIndex={0}
                      onClick={() => setEditing(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && event.target === event.currentTarget) {
                          setEditing(entry);
                        }
                      }}
                      title="Abrir para editar"
                    >
                      <td className="fin-date">{ledgerDate(entry.date)}</td>
                      <td>
                        <span className="fin-desc-main">
                          {entry.description ?? entry.placeName ?? "Sem descrição"}
                          <InstallmentBadge entry={entry} />
                        </span>
                        {entry.placeName && entry.description && (
                          <small className="fin-sub">{entry.placeName}</small>
                        )}
                        {anticipatedIds.has(entry.id) && (
                          <span className="fin-inline">
                            <em className="fin-refund-tag" title="Parcela antecipada">
                              antecipada
                            </em>
                            <Button
                              variant="ghost"
                              icon={RotateCcw}
                              onClick={(event) => {
                                event.stopPropagation();
                                void restore(entry.id);
                              }}
                            >
                              Restaurar
                            </Button>
                          </span>
                        )}
                      </td>
                      <td>
                        {entry.categoryName ? (
                          <span className="fin-inline">
                            <ColorDot color={entry.categoryColor ?? "#8b949e"} />
                            {entry.categoryName}
                          </span>
                        ) : (
                          <span className="fin-muted">—</span>
                        )}
                      </td>
                      <td>{entry.personName ?? "—"}</td>
                      <td className="num fin-amount">{moneyFromCents(-entry.amountCents)}</td>
                      <td className="fin-row-actions" onClick={(event) => event.stopPropagation()}>
                        {onNavigate && (
                          <IconButton
                            icon={Search}
                            label="Ver nas transações"
                            onClick={() => showInLedger(entry)}
                          />
                        )}
                        {onNavigate && entry.installmentPlanId != null && (
                          <IconButton
                            icon={ListTree}
                            label="Ver todas as parcelas desta compra"
                            onClick={() => showPlanInLedger(entry)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={4}>Total da fatura</th>
                    <th className="num">{moneyFromCents(detail.totalCents)}</th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Pagamentos em bloco separado: nunca misturados às compras. */}
          {detail.payments.length > 0 && (
            <div className="fin-payments">
              <h4>Pagamentos</h4>
              <ul className="fin-list">
                {detail.payments.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      {ledgerDate(entry.date)} · {entry.counterpartAccountName ?? "conta"}
                    </span>
                    <span className="fin-list-meta">
                      <strong className="fin-positive">{moneyFromCents(entry.amountCents)}</strong>
                      <Button variant="ghost" icon={Undo2} onClick={() => void undoPayment(entry)}>
                        Desfazer
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      {futureInstallments.length > 0 && (
        <Panel
          title="Parcelas futuras"
          subtitle="Clique numa parcela para editar só ela, ela e as próximas, ou a série toda"
        >
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fatura</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  <th className="num">Valor</th>
                  <th aria-label="Ir para" />
                </tr>
              </thead>
              <tbody>
                {[...futureInstallments]
                  .sort(
                    (a, b) =>
                      (a.statementMonth ?? "").localeCompare(b.statementMonth ?? "") ||
                      a.date.localeCompare(b.date)
                  )
                  .map((entry) => (
                    <tr
                      key={entry.id}
                      className="fin-row-click"
                      tabIndex={0}
                      onClick={() => setEditing(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && event.target === event.currentTarget) {
                          setEditing(entry);
                        }
                      }}
                      title="Abrir para editar"
                    >
                      <td className="fin-date">
                        {entry.statementMonth ? monthLabel(entry.statementMonth) : "—"}
                      </td>
                      <td>
                        <span className="fin-desc-main">
                          {entry.description ?? entry.placeName ?? "Sem descrição"}
                          <InstallmentBadge entry={entry} />
                        </span>
                      </td>
                      <td>{entry.categoryName ?? <span className="fin-muted">—</span>}</td>
                      <td className="num fin-amount">{moneyFromCents(-entry.amountCents)}</td>
                      <td className="fin-row-actions" onClick={(event) => event.stopPropagation()}>
                        {onNavigate && (
                          <IconButton
                            icon={ListTree}
                            label="Ver todas as parcelas desta compra"
                            onClick={() => showPlanInLedger(entry)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {trend.length > 1 && (
        <Panel title="Evolução da fatura" subtitle="Últimas 12 faturas, incluindo as futuras">
          <AreaTrend data={trend} dataKey="value" />
        </Panel>
      )}

      {/* O formulário nasce com os cadastros já carregados: aberto antes, trataria o cartão como conta arquivada. */}
      {editing && !reference.loading && (
        <EntryDrawer
          entry={editing}
          reference={reference}
          onReloadReference={reference.reload}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refreshAll();
            await reference.reload();
          }}
        />
      )}

      {anticipating && card && (
        <AnticipateDrawer
          cardId={card.id}
          installments={futureInstallments}
          statements={statements}
          defaultMonth={card.currentStatementMonth}
          onClose={() => setAnticipating(false)}
          onDone={async () => {
            setAnticipating(false);
            await refreshAll();
          }}
        />
      )}

      {paying && card && active && (
        <InvoicePaymentDrawer
          card={card}
          month={active.month}
          totalCents={active.totalCents}
          dueDate={active.dueDate}
          accounts={accounts}
          onClose={() => setPaying(false)}
          onPaid={async () => {
            setPaying(false);
            await refreshAll();
          }}
        />
      )}
    </>
  );
}

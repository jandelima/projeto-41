import { HardDriveDownload, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EntryRecord, LedgerSummary } from "@projeto41/contracts";
import { AccountStrip } from "../../components/finance/AccountStrip.js";
import { CategoryGoals } from "../../components/finance/CategoryGoals.js";
import { ExportMenu } from "../../components/ExportMenu.js";
import { EntryDrawer } from "../../components/finance/EntryDrawer.js";
import { EntryFilters, type LedgerFilter } from "../../components/finance/EntryFilters.js";
import { EntryTable } from "../../components/finance/EntryTable.js";
import { Button, Loading, Panel, SectionHeading } from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { moneyFromCents, signedMoneyFromCents } from "../../lib/format.js";
import { daysBetween } from "@projeto41/finance";
import { filterToQuery, ledgerApi, useLedgerReference } from "../../lib/ledger.js";
import { paginateByDay } from "../../lib/ledger-pages.js";
import type { LedgerPreset } from "../../lib/navigation.js";
import { useToast } from "../../lib/toast.js";

/**
 * O livro. Transacoes, Gastos e Entradas sao a mesma tela com um filtro fixo
 * de tipo — o design e identico nas tres por construcao (Task 8 da fase 1).
 */

type LedgerKind = "expense" | "income";

/** Linhas por página na tela. A busca no servidor vai em lotes maiores. */
const PAGE_SIZE = 50;
const FETCH_SIZE = 500;

function firstDayOfMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastDayOfMonth() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(
    last.getDate()
  ).padStart(2, "0")}`;
}

export function LedgerPage({
  title,
  subtitle,
  fixedKind,
  preset = {}
}: {
  title: string;
  subtitle: string;
  /** Ausente em Transações: a tela mostra tudo, inclusive transferências. */
  fixedKind?: LedgerKind;
  /** Recorte trazido de outra tela, como o card do Painel. */
  preset?: LedgerPreset;
}) {
  const toast = useToast();
  const reference = useLedgerReference();
  const [filter, setFilter] = useState<LedgerFilter>(() => ({
    // Chegando de outra tela com um recorte que não é de datas (a fatura, uma
    // compra parcelada), o filtro pega todo o histórico: o mês corrente
    // esconderia justamente as parcelas que a pessoa foi procurar.
    from: preset.from ?? (preset.allTime ? undefined : firstDayOfMonth()),
    to: preset.to ?? (preset.allTime ? undefined : lastDayOfMonth()),
    ...(preset.personId != null ? { personId: preset.personId } : {}),
    ...(preset.accountId != null ? { accountId: preset.accountId } : {}),
    ...(preset.installmentPlanId != null ? { installmentPlanId: preset.installmentPlanId } : {}),
    ...(preset.statementMonth ? { statementMonth: preset.statementMonth } : {}),
    page: 1,
    pageSize: PAGE_SIZE
  }));
  const [result, setResult] = useState<Awaited<ReturnType<typeof ledgerApi.entries>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EntryRecord | null>(null);
  const [creating, setCreating] = useState(false);
  // Saldo e fatura de cada conta, como no Painel. Só em Transações: é a tela
  // de conferir contra o banco; Gastos e Entradas têm o próprio resumo.
  const [accounts, setAccounts] = useState<LedgerSummary["accounts"] | null>(null);
  const loadAccounts = useCallback(async () => {
    if (fixedKind) return;
    try {
      // Entradas e saídas de cada conta no mesmo período do filtro.
      const query = filterToQuery({ from: filter.from, to: filter.to });
      setAccounts((await api<LedgerSummary>(`/ledger/summary${query}`)).accounts);
    } catch {
      // O livro continua útil sem a faixa: o erro do livro já aparece sozinho.
    }
  }, [fixedKind, filter.from, filter.to]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const effectiveFilter = useMemo(
    () => (fixedKind ? { ...filter, kind: fixedKind } : filter),
    [filter, fixedKind]
  );
  // A página é da tela, não do servidor: trocar de página não busca de novo.
  const queryFilter = { ...effectiveFilter, page: undefined, pageSize: undefined };
  const queryKey = JSON.stringify(queryFilter);

  /**
   * Busca tudo que o filtro pega, em lotes, para paginar por dia aqui: a
   * página do servidor corta pela contagem de linhas e partia um dia ao meio.
   */
  const latest = useRef(0);
  const load = useCallback(async () => {
    // Trocar o filtro no meio de uma busca não pode deixar a resposta velha
    // chegar por último e ocupar a tela.
    const request = ++latest.current;
    try {
      const query = JSON.parse(queryKey) as typeof queryFilter;
      const first = await ledgerApi.entries({ ...query, page: 1, pageSize: FETCH_SIZE });
      const rows = [...first.rows];
      for (let page = 2; rows.length < first.total; page++) {
        const next = await ledgerApi.entries({ ...query, page, pageSize: FETCH_SIZE });
        if (request !== latest.current) return;
        if (next.rows.length === 0) break;
        rows.push(...next.rows);
      }
      if (request !== latest.current) return;
      setResult({ ...first, rows, page: 1, pageSize: rows.length });
    } catch (error) {
      if (request !== latest.current) return;
      toast.notify(error instanceof Error ? error.message : "Falha ao carregar", "error");
    } finally {
      setLoading(false);
    }
  }, [queryKey, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = result?.totals;
  const pages = useMemo(() => paginateByDay(result?.rows ?? [], PAGE_SIZE), [result]);
  const pageCount = Math.max(1, pages.length);
  const currentPage = Math.min(filter.page ?? 1, pageCount);

  return (
    <>
      <SectionHeading title={title} subtitle={subtitle}>
        {/* Backup fica visível: num app local sem nuvem é requisito, não conveniência. */}
        <Button
          variant="ghost"
          icon={HardDriveDownload}
          onClick={() => window.open("/api/backup", "_blank")}
        >
          Backup
        </Button>
        <ExportMenu
          csvUrl={`/api/ledger/export.csv${filterToQuery(effectiveFilter)}`}
          pdfUrl={
            effectiveFilter.from && effectiveFilter.to
              ? `/api/ledger/report.pdf${filterToQuery({ from: effectiveFilter.from, to: effectiveFilter.to })}`
              : null
          }
          pdfHint="O PDF precisa de um período: escolha as datas inicial e final."
        />
        <Button icon={Plus} onClick={() => setCreating(true)}>
          Novo lançamento
        </Button>
      </SectionHeading>

      {accounts && <AccountStrip accounts={accounts} />}

      <Panel bodyClass="fin-filter-body">
        <EntryFilters
          filter={filter}
          onChange={setFilter}
          reference={reference}
          lockedKind={fixedKind != null}
        />
      </Panel>

      <FlowSummary
        totals={totals}
        count={result?.total ?? 0}
        fixedKind={fixedKind}
        from={filter.from}
        to={filter.to}
      />

      {fixedKind === "expense" && filter.from && filter.to && (
        <Panel
          title="Objetivos por categoria"
          subtitle={
            filter.personId != null
              ? "Da casa toda: o objetivo é da categoria, não de uma pessoa"
              : "Quanto cada categoria gastou contra o objetivo, em valor ou em percentual"
          }
        >
          <CategoryGoals from={filter.from} to={filter.to} />
        </Panel>
      )}

      <Panel
        title={`${result?.total ?? 0} lançamento${(result?.total ?? 0) === 1 ? "" : "s"}`}
        subtitle={
          pageCount > 1
            ? `Página ${currentPage} de ${pageCount} · os totais acima são do filtro inteiro`
            : "Do mais recente para o mais antigo"
        }
      >
        {loading ? (
          <Loading />
        ) : (
          <EntryTable rows={pages[currentPage - 1] ?? []} onSelect={setEditing} />
        )}

        {pageCount > 1 && (
          <div className="fin-pager">
            <Button
              variant="ghost"
              disabled={currentPage <= 1}
              onClick={() => {
                setFilter((current) => ({ ...current, page: currentPage - 1 }));
                window.scrollTo({ top: 0 });
              }}
            >
              Anterior
            </Button>
            <span>
              Página {currentPage} de {pageCount}
            </span>
            <Button
              variant="ghost"
              disabled={currentPage >= pageCount}
              onClick={() => {
                setFilter((current) => ({ ...current, page: currentPage + 1 }));
                window.scrollTo({ top: 0 });
              }}
            >
              Próxima
            </Button>
          </div>
        )}
      </Panel>

      {(creating || editing) && (
        <EntryDrawer
          entry={editing}
          reference={reference}
          defaultKind={fixedKind ?? "expense"}
          onReloadReference={reference.reload}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await Promise.all([load(), loadAccounts()]);
            await reference.reload();
          }}
        />
      )}
    </>
  );
}

/**
 * O resumo do filtro, não da página. Em Transações, a barra mostra quanto das
 * entradas as saídas consumiram; em Gastos, a média por dia diz mais que o
 * total sozinho.
 */
function FlowSummary({
  totals,
  count,
  fixedKind,
  from,
  to
}: {
  totals: { incomeCents: number; expenseCents: number; netCents: number } | undefined;
  count: number;
  fixedKind?: LedgerKind;
  from?: string;
  to?: string;
}) {
  const income = totals?.incomeCents ?? 0;
  const expense = Math.abs(totals?.expenseCents ?? 0);
  const days = from && to ? daysBetween(from, to) + 1 : null;
  const consumed = income > 0 ? expense / income : null;

  const metrics: { label: string; value: string; tone?: string }[] = [];
  if (fixedKind !== "expense") {
    metrics.push({ label: "Entradas", value: moneyFromCents(income), tone: "fin-positive" });
  }
  if (fixedKind !== "income") {
    metrics.push({ label: "Saídas", value: moneyFromCents(-expense), tone: "fin-negative" });
  }
  if (!fixedKind) {
    metrics.push({
      label: "Líquido",
      value: signedMoneyFromCents(totals?.netCents ?? 0),
      tone: (totals?.netCents ?? 0) < 0 ? "fin-negative" : ""
    });
  }
  if (fixedKind === "expense" && days) {
    metrics.push({ label: "Média por dia", value: moneyFromCents(-Math.round(expense / days)) });
  }
  metrics.push({ label: "Lançamentos", value: String(count) });

  return (
    <Panel className="fin-flow-panel">
      <div className="fin-flow">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong className={metric.tone}>{metric.value}</strong>
          </div>
        ))}
      </div>
      {!fixedKind && (income > 0 || expense > 0) && (
        <div className="fin-flow-bar-wrap">
          <div
            className="fin-flow-bar"
            role="img"
            aria-label={
              consumed == null
                ? "Sem entradas no período"
                : `Saídas consumiram ${Math.round(consumed * 100)}% das entradas`
            }
          >
            <span
              className="expense"
              style={{ width: `${Math.min(100, consumed == null ? 100 : consumed * 100)}%` }}
            />
          </div>
          <small className="fin-muted">
            {consumed == null
              ? "Sem entradas no período"
              : consumed > 1
                ? `Saídas passaram as entradas em ${moneyFromCents(expense - income)}`
                : `Saídas consumiram ${Math.round(consumed * 100)}% das entradas`}
          </small>
        </div>
      )}
    </Panel>
  );
}

type PresetProps = { preset?: LedgerPreset };

export const TransactionsPage = ({ preset }: PresetProps) => (
  <LedgerPage
    title="Transações"
    subtitle="Tudo que entrou, saiu e foi transferido"
    preset={preset}
  />
);

export const ExpensesPage = ({ preset }: PresetProps) => (
  <LedgerPage
    title="Gastos"
    subtitle="Só as saídas, pelo mesmo livro"
    fixedKind="expense"
    preset={preset}
  />
);

export const IncomePage = ({ preset }: PresetProps) => (
  <LedgerPage
    title="Entradas"
    subtitle="Só as receitas, pelo mesmo livro"
    fixedKind="income"
    preset={preset}
  />
);

import { Eye, EyeOff, Menu, Moon, RefreshCw, ShieldCheck, Sun, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AllocationPage } from "../pages/Allocation.js";
import { InvestmentCashPage } from "../pages/InvestmentCash.js";
import { ContributionsPage } from "../pages/Contributions.js";
import { DashboardPage } from "../pages/Dashboard.js";
import { HistoryPage } from "../pages/History.js";
import { PlanningPage } from "../pages/Planning.js";
import { PortfolioPage } from "../pages/Portfolio.js";
import { PositionsPage } from "../pages/Positions.js";
import { AccountsPage } from "../pages/finance/Accounts.js";
import { CategoriesPage } from "../pages/finance/Categories.js";
import { FinanceDashboardPage } from "../pages/finance/FinanceDashboard.js";
import { InvoicePage } from "../pages/finance/Invoice.js";
import { GoalsPage } from "../pages/finance/Goals.js";
import { ImportPage } from "../pages/finance/Import.js";
import { NetWorthPage } from "../pages/finance/NetWorth.js";
import { ReportsPage } from "../pages/finance/Reports.js";
import { SpendingAllocationPage } from "../pages/finance/SpendingAllocation.js";
import {
  ExpensesPage,
  IncomePage,
  TransactionsPage
} from "../pages/finance/Ledger.js";
import { InvestmentAccountSwitch } from "../components/InvestmentAccountSwitch.js";
import { Loading } from "../components/ui.js";
import { Ticker, TickerSettings } from "../components/ticker.js";
import type { TickerCandidate } from "../components/ticker.js";
import { api } from "../lib/api.js";
import {
  ALL_INVESTMENT_ACCOUNTS,
  currentInvestmentAccount,
  PRINCIPAL_INVESTMENT_ACCOUNT,
  setCurrentInvestmentAccount
} from "../lib/investment-account.js";
import { relativeTime } from "../lib/format.js";
import { portfolioIconUrl } from "../lib/icons.js";
import { usePrivacy } from "../lib/privacy.js";
import { useTheme } from "../lib/theme.js";
import { useToast } from "../lib/toast.js";
import type { LedgerPreset } from "../lib/navigation.js";
import type { Dashboard, InvestmentAccount } from "@projeto41/contracts";
import {
  initialPage,
  lastPageOf,
  moduleOf,
  modules,
  navItem,
  rememberPage,
  type ModuleId,
  type Page
} from "./modules.js";

const TICKER_HIDDEN_KEY = "projeto41-ticker-hidden";

function readTickerHidden(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(TICKER_HIDDEN_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function App() {
  const { theme, toggle } = useTheme();
  const privacy = usePrivacy();
  const toast = useToast();
  const demoMode =
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_DEMO_MODE === "true";

  const [page, setPage] = useState<Page>(initialPage);
  // Recorte levado de uma tela para outra (periodo, pessoa). A chave remonta a
  // tela de destino para que ela nasca com o filtro, em vez de herdar o antigo.
  const [preset, setPreset] = useState<{ key: number; value: LedgerPreset }>({
    key: 0,
    value: {}
  });
  const navigate = useCallback((next: Page, value: LedgerPreset = {}) => {
    setPage(next);
    rememberPage(next);
    setPreset((current) => ({ key: current.key + 1, value }));
    window.scrollTo({ top: 0 });
  }, []);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tickerHidden, setTickerHidden] = useState<Set<string>>(readTickerHidden);
  const [tickerOpen, setTickerOpen] = useState(false);

  const module = moduleOf(page);
  const current = navItem(page);
  const investing = module.id === "investments";

  // O módulo vai para o <html>, como o tema: a cor de destaque de cada um
  // alcança também o fundo e o que não mora dentro do app-shell.
  useEffect(() => {
    document.documentElement.dataset.module = module.id;
  }, [module.id]);

  const switchModule = (id: ModuleId) => {
    if (id === module.id) return;
    navigate(lastPageOf(id));
  };

  useEffect(() => {
    window.localStorage.setItem(TICKER_HIDDEN_KEY, JSON.stringify([...tickerHidden]));
  }, [tickerHidden]);

  const toggleTickerAsset = useCallback((symbol: string) => {
    setTickerHidden((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }, []);

  // Conta do módulo de investimentos: cada uma com os próprios registros.
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [investmentAccountId, setInvestmentAccountId] = useState(currentInvestmentAccount);
  const chooseInvestmentAccount = useCallback((id: number) => {
    if (id === currentInvestmentAccount()) return;
    setCurrentInvestmentAccount(id);
    setInvestmentAccountId(id);
    setLoading(true);
  }, []);
  const loadInvestmentAccounts = useCallback(async () => {
    const list = await api<InvestmentAccount[]>("/investment-accounts", {
      headers: ALL_INVESTMENT_ACCOUNTS
    });
    setInvestmentAccounts(list);
    // A conta lembrada pode não existir mais (banco recriado).
    if (!list.some((account) => account.id === currentInvestmentAccount())) {
      chooseInvestmentAccount(PRINCIPAL_INVESTMENT_ACCOUNT);
    }
  }, [chooseInvestmentAccount]);
  // Recarrega ao entrar no módulo: uma pessoa nova de Finanças já aparece.
  useEffect(() => {
    void loadInvestmentAccounts().catch(() => undefined);
  }, [loadInvestmentAccounts, investing]);

  // O Patrimônio do módulo de finanças soma todas as contas de investimento;
  // as telas de investimento veem só a conta escolhida.
  const loadDashboard = useCallback(async () => {
    try {
      setError("");
      setDashboard(
        await api<Dashboard>("/dashboard", investing ? undefined : { headers: ALL_INVESTMENT_ACCOUNTS })
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os dados");
    } finally {
      setLoading(false);
    }
    // A conta entra nas dependências para recarregar ao trocar de conta.
  }, [investing, investmentAccountId]);

  useEffect(() => void loadDashboard(), [loadDashboard]);

  useEffect(() => {
    const REFRESH_INTERVAL = 2 * 60 * 1000;
    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => void loadDashboard(), REFRESH_INTERVAL);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void loadDashboard();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadDashboard]);

  async function refreshPrices() {
    setRefreshing(true);
    try {
      await api("/prices/refresh", { method: "POST" });
      await loadDashboard();
      toast.notify("Cotações atualizadas");
    } catch (caught) {
      toast.notify(caught instanceof Error ? caught.message : "Falha ao atualizar preços", "error");
    } finally {
      setRefreshing(false);
    }
  }

  const tickerCandidates = useMemo<TickerCandidate[]>(() => {
    if (!dashboard) return [];
    const tagged = [
      ...dashboard.portfolios.crypto.map((asset) => ({ asset, portfolio: "crypto" as const })),
      ...dashboard.portfolios.b3.map((asset) => ({ asset, portfolio: "b3" as const }))
    ];
    return tagged
      .filter(({ asset }) => asset.quantity > 1e-9 && asset.price > 0)
      .sort((a, b) => b.asset.marketValueBrl - a.asset.marketValueBrl)
      .map(({ asset, portfolio }) => ({
        symbol: asset.asset,
        price: asset.price,
        currency: asset.priceCurrency,
        change: asset.dayChange,
        icon: portfolioIconUrl(portfolio, asset.asset),
        portfolio
      }));
  }, [dashboard]);

  const tickerItems = useMemo(
    () => tickerCandidates.filter((item) => !tickerHidden.has(item.symbol)),
    [tickerCandidates, tickerHidden]
  );

  // As telas de finanças buscam os próprios dados: não esperam as cotações.
  // Só o Patrimônio usa o painel de investimentos, e ele aceita `null`.
  const usesDashboard = investing || page === "networth";
  const waiting = investing && loading;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <img
            className="brand-logo"
            src="/logo.png"
            alt="Projeto 41"
            onError={(event) => {
              const img = event.currentTarget;
              img.style.display = "none";
              img.insertAdjacentHTML("afterend", '<div class="brand-mark">41</div>');
            }}
          />
          <div className="brand-text">
            <strong>Projeto 41</strong>
            <span>{demoMode ? "Ambiente demonstrativo" : "Patrimônio local"}</span>
          </div>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fechar menu">
            <X size={20} />
          </button>
        </div>

        <div className="module-switch">
          <div className="module-switch-options" role="tablist" aria-label="Módulo">
            {modules.map((option) => {
              const Icon = option.icon;
              const active = option.id === module.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={active ? "active" : ""}
                  data-module={option.id}
                  onClick={() => switchModule(option.id)}
                >
                  <Icon size={18} />
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="module-switch-tagline">{module.tagline}</p>
        </div>

        {investing && investmentAccounts.length > 0 && (
          <InvestmentAccountSwitch
            accounts={investmentAccounts}
            value={investmentAccountId}
            onChange={chooseInvestmentAccount}
          />
        )}

        <nav aria-label={`Telas de ${module.label}`}>
          {module.groups.map((section) => (
            <div className="nav-group" key={section.group}>
              <span className="nav-group-label">{section.group}</span>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={page === item.id ? "nav-active" : ""}
                    aria-current={page === item.id ? "page" : undefined}
                    onClick={() => {
                      navigate(item.id);
                      setMobileOpen(false);
                    }}
                  >
                    <Icon size={18} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <ShieldCheck size={18} />
          <div>
            <strong>Somente localhost</strong>
            <span>Seus dados ficam neste computador</span>
          </div>
        </div>
      </aside>

      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}

      <main>
        {investing && tickerCandidates.length > 0 && (
          <Ticker items={tickerItems} onConfigure={() => setTickerOpen(true)} />
        )}
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu />
          </button>
          <div className="topbar-title">
            <span className="eyebrow">{module.label}</span>
            <h1>
              {current.label}
              {demoMode && <span className="demo-badge">DEMO</span>}
            </h1>
          </div>
          <div className="topbar-actions">
            {investing && dashboard?.updatedAt && (
              <span className="updated-chip">Cotações {relativeTime(dashboard.updatedAt)}</span>
            )}
            <button
              className="icon-toggle"
              onClick={privacy.toggle}
              aria-label={privacy.hidden ? "Mostrar valores" : "Ocultar valores"}
              title={privacy.hidden ? "Mostrar valores" : "Ocultar valores"}
            >
              {privacy.hidden ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <button className="icon-toggle" onClick={toggle} aria-label="Alternar tema" title="Alternar tema">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {investing && (
              <button className="refresh-button" onClick={refreshPrices} disabled={refreshing}>
                <RefreshCw size={17} className={refreshing ? "spin" : ""} />
                <span>{refreshing ? "Atualizando" : "Atualizar preços"}</span>
              </button>
            )}
          </div>
        </header>

        {usesDashboard && error && <div className="alert">{error}</div>}

        {waiting ? (
          <Loading />
        ) : (
          // Trocar de conta remonta as telas: nenhuma guarda dado da anterior.
          <div className="page" key={investmentAccountId}>
            {page === "dashboard" && dashboard && <DashboardPage data={dashboard} />}
            {page === "investment-cash" && (
              <InvestmentCashPage
                dashboard={dashboard}
                onChanged={loadDashboard}
                onBuy={(portfolio, positionId) =>
                  navigate(portfolio, { openTrade: true, payWithPositionId: positionId })
                }
                onOpenPositions={() => navigate("positions")}
              />
            )}
            {page === "crypto" && (
              <PortfolioPage
                key={preset.key}
                openTrade={preset.value.openTrade}
                payWithPositionId={preset.value.payWithPositionId}
                title="Carteira cripto"
                subtitle="Posições consolidadas em USD e convertidas para BRL"
                portfolio="crypto"
                assets={dashboard?.portfolios.crypto ?? []}
                investableTotal={dashboard?.investableBrl ?? 0}
                usdBrl={dashboard?.usdBrl ?? 0}
                onChanged={loadDashboard}
              />
            )}
            {page === "b3" && (
              <PortfolioPage
                key={preset.key}
                openTrade={preset.value.openTrade}
                payWithPositionId={preset.value.payWithPositionId}
                title="Bolsa brasileira"
                subtitle="Ativos, preço médio e dividendos acumulados"
                portfolio="b3"
                assets={dashboard?.portfolios.b3 ?? []}
                investableTotal={dashboard?.investableBrl ?? 0}
                onChanged={loadDashboard}
              />
            )}
            {page === "positions" && (
              <PositionsPage onChanged={loadDashboard} onOpenCash={() => navigate("investment-cash")} />
            )}
            {page === "contributions" && <ContributionsPage />}
            {page === "planning" && <PlanningPage />}
            {page === "allocation" && dashboard && (
              <AllocationPage
                dashboard={dashboard}
                onAllocate={(destination) =>
                  destination === "positions"
                    ? navigate("investment-cash")
                    : navigate(destination, { openTrade: true })
                }
                onOpenCash={() => navigate("investment-cash")}
              />
            )}
            {page === "history" && (
              <HistoryPage
                history={dashboard?.history ?? []}
                cashControlStartedOn={dashboard?.cashControlStartedOn ?? null}
              />
            )}
            {page === "finance" && <FinanceDashboardPage onNavigate={navigate} />}
            {page === "reports" && <ReportsPage />}
            {page === "invoice" && <InvoicePage onNavigate={navigate} />}
            {page === "goals" && <GoalsPage />}
            {page === "import" && <ImportPage />}
            {page === "networth" && (
              <NetWorthPage dashboard={dashboard} onChanged={loadDashboard} />
            )}
            {page === "transactions" && <TransactionsPage key={preset.key} preset={preset.value} />}
            {page === "expenses" && <ExpensesPage key={preset.key} preset={preset.value} />}
            {page === "income" && <IncomePage key={preset.key} preset={preset.value} />}
            {page === "accounts" && <AccountsPage onOpenCash={() => navigate("investment-cash")} />}
            {page === "categories" && <CategoriesPage />}
            {page === "spending-allocation" && <SpendingAllocationPage />}
          </div>
        )}
      </main>

      {tickerOpen && (
        <TickerSettings
          candidates={tickerCandidates}
          hidden={tickerHidden}
          onToggle={toggleTickerAsset}
          onShowAll={() => setTickerHidden(new Set())}
          onClose={() => setTickerOpen(false)}
        />
      )}
    </div>
  );
}

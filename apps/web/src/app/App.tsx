import {
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  Coins,
  Eye,
  EyeOff,
  History,
  LayoutDashboard,
  Menu,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Target,
  Wallet,
  X
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ComponentType } from "react";
import { AllocationPage } from "../pages/Allocation.js";
import { ContributionsPage } from "../pages/Contributions.js";
import { DashboardPage } from "../pages/Dashboard.js";
import { HistoryPage } from "../pages/History.js";
import { PlanningPage } from "../pages/Planning.js";
import { PortfolioPage } from "../pages/Portfolio.js";
import { PositionsPage } from "../pages/Positions.js";
import { Loading } from "../components/ui.js";
import { api } from "../lib/api.js";
import { relativeTime } from "../lib/format.js";
import { usePrivacy } from "../lib/privacy.js";
import { useTheme } from "../lib/theme.js";
import { useToast } from "../lib/toast.js";
import type { Dashboard } from "../lib/types.js";

type Page =
  | "dashboard"
  | "crypto"
  | "b3"
  | "positions"
  | "contributions"
  | "planning"
  | "allocation"
  | "history";

type NavItem = { id: Page; label: string; icon: ComponentType<{ size?: number | string }> };

const nav: { group: string; items: NavItem[] }[] = [
  {
    group: "Resumo",
    items: [{ id: "dashboard", label: "Visão geral", icon: LayoutDashboard }]
  },
  {
    group: "Carteiras",
    items: [
      { id: "crypto", label: "Cripto", icon: Coins },
      { id: "b3", label: "Bolsa B3", icon: BriefcaseBusiness },
      { id: "positions", label: "Caixa e renda fixa", icon: Wallet }
    ]
  },
  {
    group: "Análises",
    items: [
      { id: "contributions", label: "Aportes", icon: CalendarDays },
      { id: "planning", label: "Planejamento", icon: ChartNoAxesCombined },
      { id: "allocation", label: "Alocação", icon: Target },
      { id: "history", label: "Histórico", icon: History }
    ]
  }
];

const allItems = nav.flatMap((section) => section.items);

export function App() {
  const { theme, toggle } = useTheme();
  const privacy = usePrivacy();
  const toast = useToast();
  const demoMode =
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_DEMO_MODE === "true";

  const [page, setPage] = useState<Page>("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      setError("");
      setDashboard(await api<Dashboard>("/dashboard"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os dados");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void loadDashboard(), [loadDashboard]);

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

  const current = allItems.find((item) => item.id === page)!;

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

        <nav>
          {nav.map((section) => (
            <div className="nav-group" key={section.group}>
              <span className="nav-group-label">{section.group}</span>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={page === item.id ? "nav-active" : ""}
                    onClick={() => {
                      setPage(item.id);
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
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu />
          </button>
          <div className="topbar-title">
            <span className="eyebrow">Carteira pessoal</span>
            <h1>
              {current.label}
              {demoMode && <span className="demo-badge">DEMO</span>}
            </h1>
          </div>
          <div className="topbar-actions">
            {dashboard?.updatedAt && (
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
            <button className="refresh-button" onClick={refreshPrices} disabled={refreshing}>
              <RefreshCw size={17} className={refreshing ? "spin" : ""} />
              <span>{refreshing ? "Atualizando" : "Atualizar preços"}</span>
            </button>
          </div>
        </header>

        {error && <div className="alert">{error}</div>}

        {loading ? (
          <Loading />
        ) : (
          <div className="page">
            {page === "dashboard" && dashboard && <DashboardPage data={dashboard} />}
            {page === "crypto" && (
              <PortfolioPage
                title="Carteira cripto"
                subtitle="Posições consolidadas em USD e convertidas para BRL"
                portfolio="crypto"
                assets={dashboard?.portfolios.crypto ?? []}
                investableTotal={dashboard ? dashboard.totalBrl - dashboard.reserveBrl : 0}
                onChanged={loadDashboard}
              />
            )}
            {page === "b3" && (
              <PortfolioPage
                title="Bolsa brasileira"
                subtitle="Ativos, preço médio e dividendos acumulados"
                portfolio="b3"
                assets={dashboard?.portfolios.b3 ?? []}
                investableTotal={dashboard ? dashboard.totalBrl - dashboard.reserveBrl : 0}
                onChanged={loadDashboard}
              />
            )}
            {page === "positions" && <PositionsPage onChanged={loadDashboard} />}
            {page === "contributions" && <ContributionsPage />}
            {page === "planning" && <PlanningPage />}
            {page === "allocation" && dashboard && <AllocationPage dashboard={dashboard} />}
            {page === "history" && <HistoryPage history={dashboard?.history ?? []} />}
          </div>
        )}
      </main>
    </div>
  );
}

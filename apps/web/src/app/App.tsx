import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bitcoin,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  History,
  Landmark,
  LayoutDashboard,
  Menu,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Target,
  Trash2,
  WalletCards,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api } from "../lib/api.js";

type Page =
  | "dashboard"
  | "crypto"
  | "b3"
  | "positions"
  | "contributions"
  | "planning"
  | "allocation"
  | "history";

type Price = {
  symbol: string;
  price: number;
  currency: string;
  provider: string;
  fetchedAt: string;
  error: string | null;
};

type Asset = {
  asset: string;
  quantity: number;
  invested: number;
  averagePrice: number;
  soldValue: number;
  marketValue: number;
  marketValueBrl: number;
  currentReturn: number;
  totalReturn: number;
  dividends: number;
  price: number;
  priceCurrency: string;
  priceStatus: string;
  priceFetchedAt: string | null;
};

type Snapshot = {
  date: string;
  totalBrl: number;
  payload: Record<string, number>;
};

type Dashboard = {
  totalBrl: number;
  totalUsd: number;
  usdBrl: number;
  categories: Record<string, number>;
  annualContributions: number;
  annualReturn: number;
  history: Snapshot[];
  prices: Price[];
  portfolios: { crypto: Asset[]; b3: Asset[] };
  reserveBrl: number;
  updatedAt: string;
};

const nav: { id: Page; label: string; icon: typeof Activity }[] = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "crypto", label: "Cripto", icon: Bitcoin },
  { id: "b3", label: "Bolsa B3", icon: BriefcaseBusiness },
  { id: "positions", label: "Caixa e renda fixa", icon: Landmark },
  { id: "contributions", label: "Aportes", icon: CalendarDays },
  { id: "planning", label: "Planejamento", icon: ChartNoAxesCombined },
  { id: "allocation", label: "Alocação", icon: Target },
  { id: "history", label: "Histórico", icon: History }
];

export function App() {
  const demoMode = (import.meta as ImportMeta & { env?: Record<string, string> }).env
    ?.VITE_DEMO_MODE === "true";
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
      setError(caught instanceof Error ? caught.message : "Nao foi possivel carregar os dados");
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao atualizar precos");
    } finally {
      setRefreshing(false);
    }
  }

  const current = nav.find((item) => item.id === page)!;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">41</div>
          <div>
            <strong>Projeto 41</strong>
            <span>{demoMode ? "Ambiente demonstrativo" : "Patrimônio local"}</span>
          </div>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fechar menu">
            <X size={20} />
          </button>
        </div>
        <nav>
          {nav.map((item) => {
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
                <Icon size={19} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          <div>
            <strong>Somente localhost</strong>
            <span>Seus dados ficam neste computador</span>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu />
          </button>
          <div>
            <span className="eyebrow">CARTEIRA PESSOAL</span>
            <h1>
              {current.label}
              {demoMode && <span className="demo-badge">DEMO</span>}
            </h1>
          </div>
          <button className="refresh-button" onClick={refreshPrices} disabled={refreshing}>
            <RefreshCw size={17} className={refreshing ? "spin" : ""} />
            {refreshing ? "Atualizando" : "Atualizar preços"}
          </button>
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
                onChanged={loadDashboard}
              />
            )}
            {page === "b3" && (
              <PortfolioPage
                title="Bolsa brasileira"
                subtitle="Ativos, preço médio e dividendos acumulados"
                portfolio="b3"
                assets={dashboard?.portfolios.b3 ?? []}
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

function DashboardPage({ data }: { data: Dashboard }) {
  const categoryData = categoryRows(data.categories).filter((item) => item.value > 0);
  const history = data.history.slice(-180);
  const returnYear = data.annualReturn;
  const stale = data.prices.filter((price) => price.error).length;

  return (
    <>
      <section className="hero-grid">
        <article className="hero-card">
          <div className="card-label">
            <WalletCards size={18} />
            Patrimônio total
          </div>
          <strong className="hero-value">{money(data.totalBrl)}</strong>
          <div className="hero-meta">
            <span>{usd(data.totalUsd)}</span>
            <span>USD/BRL {decimal(data.usdBrl, 4)}</span>
          </div>
          <div className="glow" />
        </article>
        <MetricCard
          icon={returnYear >= 0 ? ArrowUpRight : ArrowDownRight}
          label="Rentabilidade no ano"
          value={percent(returnYear)}
          tone={returnYear >= 0 ? "positive" : "negative"}
          detail="descontando aportes registrados"
        />
        <MetricCard
          icon={CircleDollarSign}
          label="Aportes no ano"
          value={money(data.annualContributions)}
          detail="total acumulado"
        />
        <MetricCard
          icon={Landmark}
          label="Reserva"
          value={money(data.reserveBrl)}
          detail={`${percent(data.totalBrl ? data.reserveBrl / data.totalBrl : 0)} do patrimônio`}
        />
      </section>

      <section className="dashboard-grid">
        <Panel title="Evolução patrimonial" subtitle="Últimos 180 registros" className="chart-panel wide">
          {history.length ? (
            <ResponsiveContainer width="100%" height={310}>
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="wealth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c6cff" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#7c6cff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#232a3a" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={36} />
                <YAxis tickFormatter={compactMoney} width={72} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="totalBrl"
                  stroke="#8b7cff"
                  strokeWidth={2.5}
                  fill="url(#wealth)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty text="O histórico aparecerá após a importação." />
          )}
        </Panel>
        <Panel title="Distribuição" subtitle="Saldo por classe" className="chart-panel">
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={categoryData} dataKey="value" innerRadius={66} outerRadius={94} paddingAngle={3}>
                  {categoryData.map((item, index) => (
                    <Cell key={item.key} fill={palette[index % palette.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => money(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="legend-list">
              {categoryData.map((item, index) => (
                <div key={item.key}>
                  <span className="legend-dot" style={{ background: palette[index % palette.length] }} />
                  <span>{item.label}</span>
                  <strong>{percent(data.totalBrl ? item.value / data.totalBrl : 0)}</strong>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </section>

      <Panel
        title="Saúde das cotações"
        subtitle={`${data.prices.length} ativos monitorados · ${stale ? `${stale} com alerta` : "tudo atualizado"}`}
      >
        <div className="price-strip">
          {data.prices.slice(0, 12).map((price) => (
            <div className="price-chip" key={price.symbol}>
              <span className={price.error ? "status warning" : "status"} />
              <div>
                <strong>{price.symbol}</strong>
                <small>{price.provider}</small>
              </div>
              <b>{price.currency === "BRL" ? money(price.price) : usd(price.price)}</b>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

function PortfolioPage({
  title,
  subtitle,
  portfolio,
  assets,
  onChanged
}: {
  title: string;
  subtitle: string;
  portfolio: "crypto" | "b3";
  assets: Asset[];
  onChanged: () => Promise<void>;
}) {
  const [operations, setOperations] = useState<any[]>([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const load = useCallback(
    () => api<any[]>(`/operations?portfolio=${portfolio}`).then(setOperations),
    [portfolio]
  );
  useEffect(() => void load(), [load]);

  async function remove(id: number) {
    if (!confirm("Excluir esta operação?")) return;
    await api(`/operations/${id}`, { method: "DELETE" });
    await Promise.all([load(), onChanged()]);
  }

  async function saveDividend(asset: string, amount: number) {
    await api(`/dividends/${asset}`, { method: "PUT", body: JSON.stringify({ amount }) });
    await onChanged();
  }

  return (
    <>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button className="primary" onClick={() => setModal(true)}>
          <Plus size={17} /> Nova operação
        </button>
      </div>
      <div className="summary-row">
        <MiniStat label="Saldo atual" value={money(assets.reduce((sum, item) => sum + item.marketValueBrl, 0))} />
        <MiniStat label="Ativos" value={String(assets.length)} />
        <MiniStat
          label="Valor vendido"
          value={
            portfolio === "crypto"
              ? usd(assets.reduce((sum, item) => sum + item.soldValue, 0))
              : money(assets.reduce((sum, item) => sum + item.soldValue, 0))
          }
        />
      </div>
      <Panel title="Posições" subtitle="Calculadas automaticamente pelas operações">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ativo</th>
                <th>Quantidade</th>
                <th>Preço atual</th>
                <th>Preço médio</th>
                <th>Saldo</th>
                {portfolio === "b3" && <th>Dividendos</th>}
                <th>PnL total</th>
                <th>Cotação</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.asset}>
                  <td><AssetName symbol={asset.asset} /></td>
                  <td>{decimal(asset.quantity, 8)}</td>
                  <td>{asset.priceCurrency === "USD" ? usd(asset.price) : money(asset.price)}</td>
                  <td>{portfolio === "crypto" ? usd(asset.averagePrice) : money(asset.averagePrice)}</td>
                  <td><strong>{money(asset.marketValueBrl)}</strong></td>
                  {portfolio === "b3" && (
                    <td>
                      <InlineMoney value={asset.dividends} onSave={(value) => saveDividend(asset.asset, value)} />
                    </td>
                  )}
                  <td className={asset.totalReturn >= 0 ? "positive-text" : "negative-text"}>
                    {percent(asset.totalReturn)}
                  </td>
                  <td><Status status={asset.priceStatus} time={asset.priceFetchedAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!assets.length && <Empty text="Nenhuma posição cadastrada." />}
        </div>
      </Panel>
      <Panel title="Operações" subtitle={`${operations.length} registros`}>
        <div className="table-scroll compact">
          <table>
            <thead><tr><th>Data</th><th>Tipo</th><th>Ativo</th><th>Quantidade</th><th>Valor</th><th /></tr></thead>
            <tbody>
              {operations.map((operation) => (
                <tr key={operation.id}>
                  <td>{longDate(operation.date)}</td>
                  <td><span className={`tag ${operation.type}`}>{operation.type === "buy" ? "Compra" : "Venda"}</span></td>
                  <td><strong>{operation.asset}</strong></td>
                  <td>{decimal(operation.quantity, 8)}</td>
                  <td>{operation.currency === "USD" ? usd(operation.total) : money(operation.total)}</td>
                  <td className="actions">
                    <button onClick={() => { setEditing(operation); setModal(true); }}><Settings2 size={16} /></button>
                    <button className="danger-icon" onClick={() => remove(operation.id)}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {modal && (
        <OperationModal
          portfolio={portfolio}
          initial={editing}
          onClose={() => { setModal(false); setEditing(null); }}
          onSaved={async () => {
            setModal(false);
            setEditing(null);
            await Promise.all([load(), onChanged()]);
          }}
        />
      )}
    </>
  );
}

function OperationModal({
  portfolio,
  initial,
  onClose,
  onSaved
}: {
  portfolio: "crypto" | "b3";
  initial?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      portfolio,
      type: data.get("type"),
      asset: String(data.get("asset")).toUpperCase(),
      date: data.get("date"),
      quantity: Number(data.get("quantity")),
      total: Number(data.get("total")),
      currency: portfolio === "crypto" ? "USD" : "BRL",
      notes: String(data.get("notes") ?? "")
    };
    await api(initial ? `/operations/${initial.id}` : "/operations", {
      method: initial ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    onSaved();
  }

  return (
    <Modal title={initial ? "Editar operação" : "Nova operação"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label>Tipo<select name="type" defaultValue={initial?.type ?? "buy"}><option value="buy">Compra</option><option value="sell">Venda</option></select></label>
        <label>Ativo<input name="asset" required defaultValue={initial?.asset} placeholder={portfolio === "crypto" ? "BTC" : "PETR4"} /></label>
        <label>Data<input name="date" type="date" required defaultValue={initial?.date === "1900-01-01" ? "" : initial?.date} /></label>
        <label>Quantidade<input name="quantity" type="number" min="0" step="any" required defaultValue={initial?.quantity} /></label>
        <label className="full">Valor total ({portfolio === "crypto" ? "USD" : "BRL"})<input name="total" type="number" min="0" step="any" required defaultValue={initial?.total} /></label>
        <label className="full">Observação<input name="notes" defaultValue={initial?.notes} /></label>
        <div className="modal-actions full"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary"><Save size={16} /> Salvar</button></div>
      </form>
    </Modal>
  );
}

function PositionsPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const [positions, setPositions] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const load = useCallback(() => api<any[]>("/positions").then(setPositions), []);
  useEffect(() => void load(), [load]);
  const groups = ["dollar", "cash", "reserve", "fixed_income"];
  const labels: Record<string, string> = {
    dollar: "Dólar",
    cash: "Caixa BR",
    reserve: "Reserva de emergência",
    fixed_income: "Renda fixa"
  };

  return (
    <>
      <div className="section-heading"><div><h2>Posições manuais</h2><p>Contas e aplicações atualizadas por você</p></div><button className="primary" onClick={() => setEditing({})}><Plus size={17} /> Nova posição</button></div>
      <div className="position-groups">
        {groups.map((group) => (
          <Panel key={group} title={labels[group]} subtitle={money(positions.filter((p) => p.category === group && p.currency === "BRL").reduce((s, p) => s + p.currentValue, 0))}>
            <div className="position-list">
              {positions.filter((position) => position.category === group).map((position) => (
                <button key={position.id} onClick={() => setEditing(position)}>
                  <div><span className="position-icon"><Landmark size={17} /></span><div><strong>{position.name}</strong><small>{position.currency} · toque para editar</small></div></div>
                  <strong>{position.currency === "USD" ? usd(position.currentValue) : money(position.currentValue)}</strong>
                </button>
              ))}
            </div>
          </Panel>
        ))}
      </div>
      {editing && <PositionModal initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await Promise.all([load(), onChanged()]); }} />}
    </>
  );
}

function PositionModal({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      category: form.get("category"),
      name: form.get("name"),
      invested: Number(form.get("invested")),
      currentValue: Number(form.get("currentValue")),
      currency: form.get("currency"),
      notes: String(form.get("notes") ?? "")
    };
    await api(initial.id ? `/positions/${initial.id}` : "/positions", { method: initial.id ? "PUT" : "POST", body: JSON.stringify(payload) });
    onSaved();
  }
  async function remove() {
    if (initial.id && confirm("Excluir esta posição?")) {
      await api(`/positions/${initial.id}`, { method: "DELETE" });
      onSaved();
    }
  }
  return (
    <Modal title={initial.id ? "Editar posição" : "Nova posição"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label>Categoria<select name="category" defaultValue={initial.category ?? "cash"}><option value="dollar">Dólar</option><option value="cash">Caixa BR</option><option value="reserve">Reserva</option><option value="fixed_income">Renda fixa</option><option value="global">Ações globais</option></select></label>
        <label>Moeda<select name="currency" defaultValue={initial.currency ?? "BRL"}><option>BRL</option><option>USD</option></select></label>
        <label className="full">Nome<input name="name" required defaultValue={initial.name} /></label>
        <label>Investimento<input name="invested" type="number" min="0" step="any" defaultValue={initial.invested ?? 0} /></label>
        <label>Valor atual<input name="currentValue" type="number" min="0" step="any" required defaultValue={initial.currentValue ?? 0} /></label>
        <label className="full">Observação<input name="notes" defaultValue={initial.notes} /></label>
        <div className="modal-actions full">{initial.id && <button type="button" className="danger-button" onClick={remove}><Trash2 size={16} /> Excluir</button>}<span /><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary"><Save size={16} /> Salvar</button></div>
      </form>
    </Modal>
  );
}

function ContributionsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api<any[]>("/contributions").then(setItems), []);
  useEffect(() => void load(), [load]);
  const monthly = useMemo(() => Array.from({ length: 12 }, (_, index) => ({
    month: monthNames[index],
    value: items.filter((item) => Number(item.date.slice(5, 7)) === index + 1).reduce((sum, item) => sum + item.amount, 0)
  })), [items]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/contributions", { method: "POST", body: JSON.stringify({ date: form.get("date"), amount: Number(form.get("amount")), notes: String(form.get("notes") ?? "") }) });
    setOpen(false); await load();
  }
  return (
    <>
      <div className="section-heading"><div><h2>Aportes</h2><p>Acompanhamento mensal e semanal</p></div><button className="primary" onClick={() => setOpen(true)}><Plus size={17} /> Registrar aporte</button></div>
      <div className="summary-row"><MiniStat label="Total no ano" value={money(items.reduce((s, i) => s + i.amount, 0))} /><MiniStat label="Média mensal" value={money(items.reduce((s, i) => s + i.amount, 0) / 12)} /><MiniStat label="Registros" value={String(items.length)} /></div>
      <Panel title="Aportes por mês" subtitle="Ano atual">
        <div className="month-grid">{monthly.map((month) => <div key={month.month}><span>{month.month}</span><strong>{money(month.value)}</strong><i style={{ height: `${Math.max(4, month.value / Math.max(...monthly.map(m => m.value), 1) * 70)}px` }} /></div>)}</div>
      </Panel>
      <Panel title="Lançamentos" subtitle="Todos os aportes importados e cadastrados">
        <div className="table-scroll compact"><table><thead><tr><th>Data</th><th>Valor</th><th>Observação</th><th /></tr></thead><tbody>{items.slice().reverse().map(item => <tr key={item.id}><td>{longDate(item.date)}</td><td><strong>{money(item.amount)}</strong></td><td>{item.notes || "—"}</td><td className="actions"><button className="danger-icon" onClick={async () => { if(confirm("Excluir aporte?")) { await api(`/contributions/${item.id}`, {method:"DELETE"}); await load(); }}}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>
      </Panel>
      {open && <Modal title="Registrar aporte" onClose={() => setOpen(false)}><form className="form-grid" onSubmit={submit}><label>Data<input name="date" type="date" required /></label><label>Valor<input name="amount" type="number" min="0" step="any" required /></label><label className="full">Observação<input name="notes" /></label><div className="modal-actions full"><button type="button" className="ghost" onClick={() => setOpen(false)}>Cancelar</button><button className="primary">Salvar</button></div></form></Modal>}
    </>
  );
}

function PlanningPage() {
  const [form, setForm] = useState<any>(null);
  useEffect(() => void api("/planning").then(setForm), []);
  const projection = useMemo(() => {
    if (!form) return [];
    const years = Math.round(Number(form.months) / 12); let balance = Number(form.initialCapital); const rows = [];
    const rate = Number(form.monthlyReturnPercent) / 100; const inflation = Number(form.annualInflationPercent) / 100;
    for (let year = 1; year <= years; year++) {
      const contribution = Number(form.monthlyContribution) * (1 + inflation) ** (year - 1);
      for (let month = 0; month < 12; month++) balance = balance * (1 + rate) + contribution;
      rows.push({ year: Number(form.initialYear) + year, nominal: balance, real: balance / (1 + inflation) ** year });
    }
    return rows;
  }, [form]);
  if (!form) return <Loading />;
  async function save() { await api("/planning", { method: "PUT", body: JSON.stringify(Object.fromEntries(Object.entries(form).map(([k,v]) => [k, Number(v)]))) }); }
  return (
    <>
      <div className="section-heading"><div><h2>Simulador patrimonial</h2><p>Projeção de aportes, rendimento e inflação</p></div><button className="primary" onClick={save}><Save size={17}/> Salvar parâmetros</button></div>
      <div className="planning-layout">
        <Panel title="Parâmetros" subtitle="Ajuste o cenário">
          <div className="stack-form">
            {([
              ["initialCapital","Capital inicial","R$"],["monthlyContribution","Aporte mensal","R$"],["monthlyReturnPercent","Rendimento mensal","%"],["months","Período","meses"],["annualInflationPercent","Inflação anual","%"],["initialYear","Ano inicial",""]
            ] as const).map(([key,label,suffix]) => <label key={key}><span>{label}</span><div><input type="number" step="any" value={form[key]} onChange={e => setForm({...form,[key]:e.target.value})}/><b>{suffix}</b></div></label>)}
          </div>
        </Panel>
        <Panel title="Projeção" subtitle={`${projection.length} anos`} className="wide">
          <ResponsiveContainer width="100%" height={360}><AreaChart data={projection}><defs><linearGradient id="nominal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c6cff" stopOpacity=".45"/><stop offset="100%" stopColor="#7c6cff" stopOpacity="0"/></linearGradient></defs><CartesianGrid stroke="#232a3a" vertical={false}/><XAxis dataKey="year"/><YAxis tickFormatter={compactMoney}/><Tooltip formatter={(value) => money(Number(value))}/><Legend/><Area name="Saldo nominal" dataKey="nominal" stroke="#8b7cff" fill="url(#nominal)" strokeWidth={2}/><Area name="Saldo corrigido" dataKey="real" stroke="#48d3a4" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer>
          <div className="projection-final"><span>Saldo real projetado</span><strong>{money(projection.at(-1)?.real ?? 0)}</strong></div>
        </Panel>
      </div>
    </>
  );
}

function AllocationPage({ dashboard }: { dashboard: Dashboard }) {
  const [targets, setTargets] = useState<any[]>([]);
  const load = useCallback(() => api<any[]>("/allocation").then(setTargets), []);
  useEffect(() => void load(), [load]);
  const rows = targets.map(target => {
    const actual = categoryValue(target.category, dashboard);
    const ideal = (dashboard.totalBrl - dashboard.reserveBrl) * target.weight;
    return { ...target, actual, ideal, difference: actual - ideal };
  });
  async function save(category: string, weight: number) { await api(`/allocation/${category}`, {method:"PUT",body:JSON.stringify({weight})}); await load(); }
  return (
    <>
      <div className="section-heading"><div><h2>Alocação ideal</h2><p>Comparação entre estratégia e carteira atual</p></div></div>
      <Panel title="Real x ideal" subtitle="Valores positivos indicam excesso na classe">
        <div className="allocation-list">{rows.map(row => <div className="allocation-row" key={row.category}><div className="allocation-name"><strong>{categoryLabel(row.category)}</strong><span>Atual {money(row.actual)}</span></div><div className="allocation-bars"><i style={{width:`${Math.min(100, dashboard.totalBrl ? row.actual/dashboard.totalBrl*100 : 0)}%`}}/><b style={{left:`${Math.min(100,row.weight*100)}%`}}/></div><div className="target-input"><input type="number" min="0" max="100" step=".5" defaultValue={row.weight*100} onBlur={e=>save(row.category, Number(e.target.value)/100)}/><span>%</span></div><strong className={row.difference >= 0 ? "positive-text":"negative-text"}>{row.difference >= 0 ? "+" : ""}{money(row.difference)}</strong></div>)}</div>
      </Panel>
    </>
  );
}

function HistoryPage({ history }: { history: Snapshot[] }) {
  return (
    <>
      <div className="section-heading"><div><h2>Histórico patrimonial</h2><p>Snapshots diários às 23:59</p></div></div>
      <Panel title="Evolução completa" subtitle={`${history.length} registros`}>
        <ResponsiveContainer width="100%" height={390}><AreaChart data={history}><defs><linearGradient id="history" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#48d3a4" stopOpacity=".4"/><stop offset="100%" stopColor="#48d3a4" stopOpacity="0"/></linearGradient></defs><CartesianGrid stroke="#232a3a" vertical={false}/><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={42}/><YAxis tickFormatter={compactMoney}/><Tooltip content={<ChartTooltip/>}/><Area dataKey="totalBrl" stroke="#48d3a4" fill="url(#history)" strokeWidth={2}/></AreaChart></ResponsiveContainer>
      </Panel>
      <Panel title="Registros" subtitle="Mais recentes primeiro"><div className="table-scroll compact"><table><thead><tr><th>Data</th><th>Patrimônio</th><th>Variação</th></tr></thead><tbody>{history.slice().reverse().map((item,index) => {const previous=history[history.length-2-index]; const change=previous ? item.totalBrl/previous.totalBrl-1:0; return <tr key={item.date}><td>{longDate(item.date)}</td><td><strong>{money(item.totalBrl)}</strong></td><td className={change>=0?"positive-text":"negative-text"}>{percent(change)}</td></tr>})}</tbody></table></div></Panel>
    </>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone = "" }: any) { return <article className={`metric-card ${tone}`}><div className="metric-icon"><Icon size={20}/></div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function MiniStat({ label, value }: {label:string;value:string}) { return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>; }
function Panel({ title, subtitle, className = "", children }: any) { return <section className={`panel ${className}`}><div className="panel-head"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{children}</section>; }
function Modal({ title, onClose, children }: any) { return <div className="modal-backdrop" onMouseDown={e => e.target===e.currentTarget && onClose()}><div className="modal"><div className="modal-head"><h3>{title}</h3><button onClick={onClose}><X size={20}/></button></div>{children}</div></div>; }
function AssetName({symbol}:{symbol:string}) { return <div className="asset-name"><span>{symbol.slice(0,2)}</span><strong>{symbol}</strong></div>; }
function Status({ status, time }: {status:string;time:string|null}) { return <div className="quote-status"><span className={`status ${status}`}/><div><strong>{status==="current"?"Atualizado":status==="stale"?"Atrasado":"Indisponível"}</strong><small>{time ? new Date(time).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):"sem cotação"}</small></div></div>; }
function InlineMoney({value,onSave}:{value:number;onSave:(v:number)=>void}) { const [editing,setEditing]=useState(false); const [draft,setDraft]=useState(value); return editing ? <input className="inline-input" autoFocus type="number" step="any" value={draft} onChange={e=>setDraft(Number(e.target.value))} onBlur={()=>{setEditing(false);onSave(draft)}}/> : <button className="inline-value" onClick={()=>setEditing(true)}>{money(value)}</button>; }
function Empty({text}:{text:string}) { return <div className="empty"><BarChart3 size={28}/><span>{text}</span></div>; }
function Loading() { return <div className="loading"><span/><span/><span/></div>; }
function ChartTooltip({ active, payload, label }: any) { if(!active||!payload?.length)return null; return <div className="chart-tooltip"><span>{longDate(label)}</span><strong>{money(payload[0].value)}</strong></div>; }

const palette = ["#7c6cff","#48d3a4","#ffb454","#4aa8ff","#ed6f95","#9ca8ff","#60d6e8"];
const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const categoryLabels:Record<string,string>={crypto:"Cripto",b3:"Bolsa Brasil",dollar:"Dólar",dolar:"Dólar",cash:"Caixa BR",caixa_br:"Caixa BR",reserve:"Reserva",fixed_income:"Renda fixa",renda_fixa:"Renda fixa",global:"Ações globais",acoes_globais:"Ações globais",bolsa_brasil:"Bolsa Brasil",bitcoin:"Bitcoin",shitcoins:"Altcoins"};
function categoryRows(categories:Record<string,number>){return Object.entries(categories).map(([key,value])=>({key,label:categoryLabels[key]??key,value}));}
function categoryLabel(key:string){return categoryLabels[key]??key;}
function categoryValue(key:string,d:Dashboard){if(key==="bitcoin")return d.portfolios.crypto.find(a=>a.asset==="BTC")?.marketValueBrl??0;if(key==="shitcoins")return d.portfolios.crypto.filter(a=>a.asset!=="BTC").reduce((s,a)=>s+a.marketValueBrl,0);const aliases:Record<string,string>={dolar:"dollar",caixa_br:"cash",bolsa_brasil:"b3",renda_fixa:"fixed_income",acoes_globais:"global"};return d.categories[aliases[key]??key]??0;}
function money(value:number){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(value||0);}
function usd(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value||0);}
function percent(value:number){return new Intl.NumberFormat("pt-BR",{style:"percent",minimumFractionDigits:2,maximumFractionDigits:2}).format(value||0);}
function decimal(value:number,digits=2){return new Intl.NumberFormat("pt-BR",{maximumFractionDigits:digits}).format(value||0);}
function compactMoney(value:number){return new Intl.NumberFormat("pt-BR",{notation:"compact",style:"currency",currency:"BRL",maximumFractionDigits:1}).format(value);}
function shortDate(value:string){return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR",{month:"short",year:"2-digit"});}
function longDate(value:string){if(!value)return "—"; if(value==="1900-01-01")return "Data não informada"; return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");}

import { ArrowDown, ArrowUp, Coins, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Drawer, useConfirm } from "../components/dialog.js";
import {
  AssetIcon,
  Button,
  Empty,
  Field,
  IconButton,
  MiniStat,
  NumberInput,
  Panel,
  SearchInput,
  SectionHeading,
  Segmented,
  Tag
} from "../components/ui.js";
import { api } from "../lib/api.js";
import { currency as fmtCurrency, currencyRaw, decimal, longDate, money, percent } from "../lib/format.js";
import { portfolioIconUrl } from "../lib/icons.js";
import { useToast } from "../lib/toast.js";
import type { Asset, Operation } from "../lib/types.js";

type SortKey = "asset" | "quantity" | "averagePrice" | "price" | "marketValueBrl" | "totalReturn";

export function PortfolioPage({
  title,
  subtitle,
  portfolio,
  assets,
  investableTotal,
  onChanged
}: {
  title: string;
  subtitle: string;
  portfolio: "crypto" | "b3";
  assets: Asset[];
  investableTotal: number;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const isCrypto = portfolio === "crypto";
  const code = isCrypto ? "USD" : "BRL";

  const [operations, setOperations] = useState<Operation[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<Operation | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "marketValueBrl", dir: -1 });

  const load = useCallback(
    () => api<Operation[]>(`/operations?portfolio=${portfolio}`).then(setOperations),
    [portfolio]
  );
  useEffect(() => void load(), [load]);

  const held = assets.filter((asset) => asset.quantity > 1e-9);
  const totalBalance = held.reduce((sum, asset) => sum + asset.marketValueBrl, 0);
  const totalInvested = held.reduce((sum, asset) => sum + asset.invested * (isCrypto ? 0 : 1), 0);
  const totalSold = assets.reduce((sum, asset) => sum + asset.soldValue, 0);
  const totalDividends = assets.reduce((sum, asset) => sum + asset.dividends, 0);

  const visible = useMemo(() => {
    const term = search.trim().toUpperCase();
    const filtered = held.filter((asset) => !term || asset.asset.includes(term));
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sort.dir;
      return ((av as number) - (bv as number)) * sort.dir;
    });
  }, [held, search, sort]);

  const assetNames = useMemo(() => [...new Set(assets.map((asset) => asset.asset))], [assets]);

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: key === "asset" ? 1 : -1 }
    );
  }

  async function removeOperation(operation: Operation) {
    const ok = await confirm({
      title: "Excluir operação",
      message: `Remover ${operation.type === "buy" ? "compra" : "venda"} de ${operation.asset}? As posições serão recalculadas.`,
      tone: "danger",
      confirmLabel: "Excluir"
    });
    if (!ok) return;
    await api(`/operations/${operation.id}`, { method: "DELETE" });
    await Promise.all([load(), onChanged()]);
    toast.notify("Operação excluída");
  }

  async function saveDividend(asset: string, amount: number) {
    await api(`/dividends/${asset}`, { method: "PUT", body: JSON.stringify({ amount }) });
    await onChanged();
    toast.notify("Dividendos atualizados");
  }

  return (
    <div className="portfolio">
      <SectionHeading title={title} subtitle={subtitle}>
        <Button icon={Plus} onClick={() => { setEditing(null); setDrawer(true); }}>
          Nova operação
        </Button>
      </SectionHeading>

      <div className="summary-row">
        <MiniStat label="Saldo atual" value={money(totalBalance)} />
        <MiniStat label="Ativos" value={String(held.length)} />
        {isCrypto ? (
          <MiniStat label="Valor vendido" value={fmtCurrency(totalSold, code)} />
        ) : (
          <MiniStat label="Investido" value={money(totalInvested)} />
        )}
        <MiniStat
          label={isCrypto ? "Operações" : "Dividendos"}
          value={isCrypto ? String(operations.length) : money(totalDividends)}
        />
      </div>

      <Panel
        title="Posições"
        subtitle="Calculadas automaticamente pelas operações"
        action={<SearchInput value={search} onChange={setSearch} placeholder="Filtrar ativo" />}
      >
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh label="Ativo" k="asset" sort={sort} onSort={toggleSort} />
                <SortableTh label="Quantidade" k="quantity" sort={sort} onSort={toggleSort} align="right" />
                <SortableTh label="Preço médio" k="averagePrice" sort={sort} onSort={toggleSort} align="right" />
                <SortableTh label="Preço atual" k="price" sort={sort} onSort={toggleSort} align="right" />
                <SortableTh label="Saldo" k="marketValueBrl" sort={sort} onSort={toggleSort} align="right" />
                {!isCrypto && <th className="right">Dividendos</th>}
                <SortableTh label="Retorno" k="totalReturn" sort={sort} onSort={toggleSort} align="right" />
                <th className="right">% carteira</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((asset) => (
                <tr key={asset.asset}>
                  <td>
                    <div className="asset-name">
                      <AssetIcon src={portfolioIconUrl(portfolio, asset.asset)} label={asset.asset} />
                      <strong>{asset.asset}</strong>
                    </div>
                  </td>
                  <td className="right num">{decimal(asset.quantity, 8)}</td>
                  <td className="right num">{currencyRaw(asset.averagePrice, code)}</td>
                  <td className="right num">{currencyRaw(asset.price, asset.priceCurrency)}</td>
                  <td className="right num">
                    <strong>{money(asset.marketValueBrl)}</strong>
                  </td>
                  {!isCrypto && (
                    <td className="right">
                      <InlineMoney value={asset.dividends} onSave={(value) => saveDividend(asset.asset, value)} />
                    </td>
                  )}
                  <td className="right">
                    <ReturnPill value={asset.totalReturn} />
                  </td>
                  <td className="right num">
                    {percent(investableTotal > 0 ? asset.marketValueBrl / investableTotal : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <Empty icon={Coins} text="Nenhuma posição encontrada." />}
        </div>
      </Panel>

      <Panel title="Operações" subtitle={`${operations.length} registros`}>
        <div className="table-scroll compact">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Ativo</th>
                <th className="right">Quantidade</th>
                <th className="right">Valor</th>
                <th className="right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((operation) => (
                <tr key={operation.id}>
                  <td>{longDate(operation.date)}</td>
                  <td>
                    <Tag tone={operation.type}>{operation.type === "buy" ? "Compra" : "Venda"}</Tag>
                  </td>
                  <td>
                    <div className="asset-name">
                      <AssetIcon src={portfolioIconUrl(portfolio, operation.asset)} label={operation.asset} />
                      <strong>{operation.asset}</strong>
                    </div>
                  </td>
                  <td className="right num">{decimal(operation.quantity, 8)}</td>
                  <td className="right num">{fmtCurrency(operation.total, operation.currency)}</td>
                  <td className="right">
                    <div className="row-actions">
                      <IconButton
                        icon={Pencil}
                        label="Editar"
                        onClick={() => { setEditing(operation); setDrawer(true); }}
                      />
                      <IconButton icon={Trash2} label="Excluir" tone="danger" onClick={() => removeOperation(operation)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!operations.length && <Empty icon={Coins} text="Nenhuma operação cadastrada ainda." />}
        </div>
      </Panel>

      {drawer && (
        <OperationDrawer
          portfolio={portfolio}
          initial={editing}
          assetNames={assetNames}
          onClose={() => { setDrawer(false); setEditing(null); }}
          onSaved={async () => {
            setDrawer(false);
            setEditing(null);
            await Promise.all([load(), onChanged()]);
            toast.notify(editing ? "Operação atualizada" : "Operação registrada");
          }}
        />
      )}
    </div>
  );
}

function OperationDrawer({
  portfolio,
  initial,
  assetNames,
  onClose,
  onSaved
}: {
  portfolio: "crypto" | "b3";
  initial: Operation | null;
  assetNames: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isCrypto = portfolio === "crypto";
  const code = isCrypto ? "USD" : "BRL";
  const initialQty = initial?.quantity ?? 0;
  const initialTotal = initial?.total ?? 0;

  const [type, setType] = useState<"buy" | "sell">(initial?.type ?? "buy");
  const [asset, setAsset] = useState(initial?.asset ?? "");
  const [date, setDate] = useState(initial && initial.date !== "1900-01-01" ? initial.date : new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState(initialQty ? String(initialQty) : "");
  const [unit, setUnit] = useState(initialQty > 0 ? String(initialTotal / initialQty) : "");
  const [total, setTotal] = useState(initialTotal ? String(initialTotal) : "");
  const [lastEdited, setLastEdited] = useState<"unit" | "total">(isCrypto ? "total" : "unit");
  const [saving, setSaving] = useState(false);

  function recalc(nextQty: string, nextUnit: string, nextTotal: string, edited: "unit" | "total" | "qty") {
    const q = Number(nextQty);
    if (edited === "unit") {
      setUnit(nextUnit);
      setTotal(q > 0 && nextUnit !== "" ? String(round(q * Number(nextUnit))) : nextTotal);
      setLastEdited("unit");
    } else if (edited === "total") {
      setTotal(nextTotal);
      setUnit(q > 0 && nextTotal !== "" ? String(round(Number(nextTotal) / q)) : nextUnit);
      setLastEdited("total");
    } else {
      setQuantity(nextQty);
      if (lastEdited === "unit") setTotal(q > 0 && nextUnit !== "" ? String(round(q * Number(nextUnit))) : nextTotal);
      else setUnit(q > 0 && nextTotal !== "" ? String(round(Number(nextTotal) / q)) : nextUnit);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!asset.trim() || Number(quantity) <= 0 || Number(total) < 0) {
      toast.notify("Preencha ativo, quantidade e valor", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        portfolio,
        type,
        asset: asset.trim().toUpperCase(),
        date,
        quantity: Number(quantity),
        total: Number(total),
        currency: code,
        notes: initial?.notes ?? ""
      };
      await api(initial ? `/operations/${initial.id}` : "/operations", {
        method: initial ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  const previewQty = Number(quantity) || 0;
  const previewTotal = Number(total) || 0;

  return (
    <Drawer
      title={initial ? "Editar operação" : "Nova operação"}
      subtitle={isCrypto ? "Carteira cripto · valores em USD" : "Bolsa B3 · valores em BRL"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="operation-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar operação"}
          </Button>
        </>
      }
    >
      <form id="operation-form" className="stack" onSubmit={submit}>
        <Field label="Tipo">
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: "buy", label: "Compra", tone: "buy" },
              { value: "sell", label: "Venda", tone: "sell" }
            ]}
          />
        </Field>
        <Field label="Ativo">
          <input
            list="asset-options"
            value={asset}
            onChange={(event) => setAsset(event.target.value.toUpperCase())}
            placeholder={isCrypto ? "BTC" : "PETR4"}
            autoFocus
          />
          <datalist id="asset-options">
            {assetNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label="Data">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <div className="field-row">
          <Field label="Quantidade">
            <NumberInput
              value={quantity}
              min="0"
              onChange={(event) => recalc(event.target.value, unit, total, "qty")}
              placeholder="0"
            />
          </Field>
          <Field label={`Preço unitário (${code})`}>
            <NumberInput
              value={unit}
              min="0"
              onChange={(event) => recalc(quantity, event.target.value, total, "unit")}
              placeholder="0"
            />
          </Field>
        </div>
        <Field label={`Valor total (${code})`} hint="Ajuste o total diretamente se houver taxas.">
          <NumberInput
            value={total}
            min="0"
            onChange={(event) => recalc(quantity, unit, event.target.value, "total")}
            placeholder="0"
          />
        </Field>
        <div className="op-preview">
          <div>
            <span>{type === "buy" ? "Comprando" : "Vendendo"}</span>
            <strong>{decimal(previewQty, 8)} {asset || "—"}</strong>
          </div>
          <div className="right">
            <span>Total</span>
            <strong>{fmtCurrency(previewTotal, code)}</strong>
          </div>
        </div>
      </form>
    </Drawer>
  );
}

function SortableTh({
  label,
  k,
  sort,
  onSort,
  align = "left"
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th className={align === "right" ? "right" : ""}>
      <button className={`th-sort ${active ? "active" : ""}`} onClick={() => onSort(k)}>
        {label}
        {active && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );
}

function ReturnPill({ value }: { value: number }) {
  return (
    <span className={`return-pill ${value >= 0 ? "up" : "down"}`}>
      {value >= 0 ? "+" : ""}
      {percent(value)}
    </span>
  );
}

function InlineMoney({ value, onSave }: { value: number; onSave: (value: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  if (editing) {
    return (
      <input
        className="inline-input"
        autoFocus
        type="number"
        step="any"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (Number(draft) !== value) onSave(Number(draft));
        }}
      />
    );
  }
  return (
    <button className="inline-value" onClick={() => setEditing(true)}>
      {money(value)}
    </button>
  );
}

function round(value: number) {
  return Math.round(value * 1e8) / 1e8;
}

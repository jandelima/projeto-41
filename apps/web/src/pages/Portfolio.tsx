import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Coins, Download, Pencil, Plus, Save, Sparkles, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { B3AssetSearch } from "../components/B3AssetSearch.js";
import { CryptoAssetSearch } from "../components/CryptoAssetSearch.js";
import { DateField } from "../components/datepicker.js";
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
import { currency as fmtCurrency, currencyRaw, decimal, fx, longDate, money, percent, todayIso } from "../lib/format.js";
import { portfolioIconUrl } from "../lib/icons.js";
import { useToast } from "../lib/toast.js";
import type { Asset, CryptoSearchResult, OperationRecord } from "@projeto41/contracts";
import { CashSourceSelect, type CashSource } from "../components/CashSourceSelect.js";
import type { CashSettings } from "../lib/cash.js";

/** A rota devolve o estado do vínculo junto da operação (fase 4). */
type OperationRow = OperationRecord & {
  accountName?: string | null;
  transferId?: number | null;
  /** Valor do lançamento no banco, em centavos de BRL. */
  ledgerCents?: number | null;
  transferStatus?: string | null;
  /** De onde veio o dinheiro: um caixa de investimento ou uma conta bancária. */
  cashSource?: "position" | "bank" | null;
  positionId?: number | null;
};

type SortKey = "asset" | "quantity" | "averagePrice" | "price" | "marketValueBrl" | "totalReturn";

export function PortfolioPage({
  title,
  subtitle,
  portfolio,
  assets,
  investableTotal,
  usdBrl = 0,
  openTrade = false,
  payWithPositionId,
  onChanged
}: {
  title: string;
  subtitle: string;
  portfolio: "crypto" | "b3";
  assets: Asset[];
  investableTotal: number;
  usdBrl?: number;
  /** Chega com a compra aberta: é o "Alocar" do caixa e da meta de alocação. */
  openTrade?: boolean;
  /** Caixa que já vem escolhido para pagar a compra aberta. */
  payWithPositionId?: number;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const isCrypto = portfolio === "crypto";
  const code = isCrypto ? "USD" : "BRL";

  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [drawer, setDrawer] = useState(openTrade);
  const [editing, setEditing] = useState<OperationRow | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "marketValueBrl", dir: -1 });
  const importInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () => api<OperationRow[]>(`/operations?portfolio=${portfolio}`).then(setOperations),
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

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: key === "asset" ? 1 : -1 }
    );
  }

  async function removeOperation(operation: OperationRow) {
    const ok = await confirm({
      title: "Excluir operação",
      message: `Remover ${operation.type === "buy" ? "compra" : "venda"} de ${operation.asset}? As posições serão recalculadas.`,
      tone: "danger",
      confirmLabel: "Excluir"
    });
    if (!ok) return;
    try {
      await api(`/operations/${operation.id}`, { method: "DELETE" });
    } catch (error) {
      // 409: existe lançamento conciliado no caminho. Em vez de um beco sem
      // saída, oferecemos o desvínculo, que é a operação que destrava.
      const message = error instanceof Error ? error.message : "Falha ao excluir";
      toast.notify(message, "error");
      const unlink = await confirm({
        title: "Desvincular e excluir",
        message: `${message} Remover o movimento de caixa e excluir a operação?`,
        confirmLabel: "Desvincular e excluir",
        tone: "danger"
      });
      if (!unlink) return;
      await api(`/operations/${operation.id}/link`, { method: "DELETE" });
      await api(`/operations/${operation.id}`, { method: "DELETE" });
    }
    await Promise.all([load(), onChanged()]);
    toast.notify("Operação excluída");
  }

  function exportOperations() {
    const link = document.createElement("a");
    link.href = "/api/export/operations.csv";
    link.download = "operacoes-cripto.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function importOperations(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const loadingId = toast.notify("Importando CSV…", "loading");
    try {
      const text = await file.text();
      const { imported } = await api<{ imported: number }>("/import/operations.csv", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text
      });
      await Promise.all([load(), onChanged()]);
      toast.dismiss(loadingId);
      toast.notify(`${imported} ${imported === 1 ? "operação importada" : "operações importadas"}`);
    } catch (error) {
      toast.dismiss(loadingId);
      toast.notify(error instanceof Error ? error.message : "Falha ao importar CSV", "error");
    }
  }

  async function clearOperations() {
    const ok = await confirm({
      title: "Remover todas as operações",
      message: `Isto apaga TODAS as ${operations.length} operações desta carteira. As posições serão zeradas. Não pode ser desfeito.`,
      tone: "danger",
      confirmLabel: "Remover tudo"
    });
    if (!ok) return;
    const { removed } = await api<{ removed: number }>(`/operations?portfolio=${portfolio}`, {
      method: "DELETE"
    });
    await Promise.all([load(), onChanged()]);
    toast.notify(`${removed} ${removed === 1 ? "operação removida" : "operações removidas"}`);
  }

  async function saveDividend(asset: string, amount: number) {
    await api(`/dividends/${asset}`, { method: "PUT", body: JSON.stringify({ amount }) });
    await onChanged();
    toast.notify("Dividendos atualizados");
  }

  return (
    <div className="portfolio">
      <SectionHeading title={title} subtitle={subtitle}>
        {isCrypto && (
          <>
            <input
              ref={importInput}
              type="file"
              accept=".csv,text/csv"
              hidden
              onInput={importOperations}
            />
            <Button
              variant="ghost"
              className="export-btn"
              icon={Upload}
              onClick={() => importInput.current?.click()}
            >
              Importar CSV
            </Button>
            <Button variant="ghost" className="export-btn" icon={Download} onClick={exportOperations}>
              Exportar CSV
            </Button>
          </>
        )}
        <Button
          variant="danger"
          icon={Trash2}
          disabled={operations.length === 0}
          onClick={clearOperations}
        >
          Limpar tudo
        </Button>
        <Button icon={Plus} onClick={() => { setEditing(null); setDrawer(true); }}>
          Nova operação
        </Button>
      </SectionHeading>

      <div className="summary-row stagger">
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
                <th>Caixa</th>
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
                  <td className="right num">
                    {operation.currency === "USD" && operation.ledgerCents != null ? (
                      <span title={`${fmtCurrency(operation.total, "USD")} na carteira`}>
                        {fmtCurrency(operation.ledgerCents / 100, "BRL")}
                        <small className="op-usd">{fmtCurrency(operation.total, "USD")}</small>
                      </span>
                    ) : (
                      fmtCurrency(operation.total, operation.currency)
                    )}
                  </td>
                  <td>
                    {/* A diferença entre operação antiga e nova fica na cara:
                        nada foi vinculado automaticamente. */}
                    {operation.cashSource === "position" ? (
                      <Tag tone="info">{operation.accountName ?? "Caixa"}</Tag>
                    ) : operation.cashSource === "bank" || operation.transferId ? (
                      <Tag tone="positive">{operation.accountName ?? "Vinculada"}</Tag>
                    ) : (
                      <Tag tone="muted">Sem caixa</Tag>
                    )}
                  </td>
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
          payWithPositionId={editing ? undefined : payWithPositionId}
          portfolio={portfolio}
          initial={editing}
          usdBrl={usdBrl}
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
  payWithPositionId,
  portfolio,
  initial,
  usdBrl,
  onClose,
  onSaved
}: {
  payWithPositionId?: number;
  portfolio: "crypto" | "b3";
  initial: OperationRow | null;
  usdBrl: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isCrypto = portfolio === "crypto";
  const initialQty = initial?.quantity ?? 0;
  const initialTotal = initial?.total ?? 0;

  const [type, setType] = useState<"buy" | "sell">(initial?.type ?? "buy");
  const [asset, setAsset] = useState(initial?.asset ?? "");
  const [slug, setSlug] = useState("");
  const [assetName, setAssetName] = useState(initial?.asset ?? "");
  const [date, setDate] = useState(initial && initial.date !== "1900-01-01" ? initial.date : todayIso());
  const canUseBrl = isCrypto && usdBrl > 0;
  // A operação é gravada na moeda em que foi digitada: quem compra em reais
  // vê reais na carteira e no livro, sem conversão de ida e volta. Ao editar,
  // a moeda é a da operação; numa nova, a última usada.
  const [entryCurrency, setEntryCurrency] = useState<"USD" | "BRL">(() =>
    initial && isCrypto
      ? initial.currency
      : canUseBrl && readEntryCurrency() !== "USD"
        ? "BRL"
        : "USD"
  );
  const [useFee, setUseFee] = useState(false);
  const code = isCrypto ? entryCurrency : "BRL";
  const storedCode = code;

  // Quantidade × Preço = Total. O usuário preenche dois campos quaisquer e o
  // terceiro é resolvido sozinho. `recent` guarda a ordem de edição: o último
  // item é o campo atualmente calculado (o "stale").
  const [fields, setFields] = useState<Record<TradeField, string>>(() => ({
    qty: initialQty ? String(initialQty) : "",
    unit: initialQty > 0 ? String(round(initialTotal / initialQty)) : "",
    total: initialTotal ? String(initialTotal) : ""
  }));
  const [recent, setRecent] = useState<TradeField[]>(
    initial || isCrypto ? ["qty", "total", "unit"] : ["qty", "unit", "total"]
  );
  const solved = recent[2] as TradeField;
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState<CashSource>({
    positionId: initial?.positionId ?? payWithPositionId ?? null,
    accountId: initial?.positionId != null ? null : (initial?.accountId ?? null)
  });
  const [defaultLoaded, setDefaultLoaded] = useState(false);

  function editField(field: TradeField, raw: string) {
    const next = { ...fields, [field]: raw };
    const order: TradeField[] = [field, ...recent.filter((f) => f !== field)];
    const target = order[2] as TradeField;
    next[target] = solveTrade(target, next);
    setFields(next);
    setRecent(order);
  }

  // Troca a moeda de digitação convertendo preço e total (a quantidade não muda).
  function changeCurrency(next: "USD" | "BRL") {
    if (next === entryCurrency) return;
    if (next === "BRL" && !canUseBrl) return;
    const factor = next === "BRL" ? usdBrl : 1 / usdBrl;
    setFields((f) => ({
      qty: f.qty,
      unit: f.unit !== "" ? String(round(Number(f.unit) * factor)) : "",
      total: f.total !== "" ? String(round(Number(f.total) * factor)) : ""
    }));
    setEntryCurrency(next);
    writeEntryCurrency(next);
  }

  useEffect(() => {
    if (initial || defaultLoaded) return;
    // O padrão é o caixa escolhido; sem caixa, a conta (se o débito estiver
    // ligado); sem nenhum dos dois, a operação é só registro.
    void api<CashSettings>("/investments/cash-settings")
      .then((settings) => {
        setSource((current) => {
          if (current.positionId != null || current.accountId != null) return current;
          if (settings.defaultPositionId != null) {
            return { positionId: settings.defaultPositionId, accountId: null };
          }
          return {
            positionId: null,
            accountId: settings.autoDebit ? settings.defaultAccountId : null
          };
        });
        setDefaultLoaded(true);
      })
      .catch(() => setDefaultLoaded(true));
  }, [initial, defaultLoaded]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let quantity = Number(fields.qty);
    let total = Number(fields.total);
    if (!asset.trim()) {
      toast.notify(isCrypto ? "Selecione um ativo na busca" : "Preencha o ativo", "error");
      return;
    }
    if (!(quantity > 0) || !Number.isFinite(total) || total < 0) {
      toast.notify("Preencha ao menos dois dos três valores", "error");
      return;
    }
    // Taxa Binance (0,1%): na compra reduz a quantidade recebida; na venda
    // reduz o valor recebido. O que foi pago/vendido permanece igual.
    if (isCrypto && useFee) {
      if (type === "buy") quantity = round(quantity * (1 - BINANCE_FEE));
      else total = round(total * (1 - BINANCE_FEE));
    }
    setSaving(true);
    try {
      const payload = {
        portfolio,
        type,
        asset: asset.trim().toUpperCase(),
        date,
        quantity,
        total,
        currency: storedCode,
        accountId: source.accountId,
        positionId: source.positionId,
        notes: initial?.notes ?? "",
        ...(isCrypto && slug ? { slug, name: assetName } : {})
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

  const feeOn = isCrypto && useFee;
  const grossQty = Number(fields.qty) || 0;
  const grossTotal = Number(fields.total) || 0;
  const netQty = feeOn && type === "buy" ? round(grossQty * (1 - BINANCE_FEE)) : grossQty;
  const netTotal = feeOn && type === "sell" ? round(grossTotal * (1 - BINANCE_FEE)) : grossTotal;
  const feeQty = grossQty - netQty;
  const feeTotal = grossTotal - netTotal;

  /**
   * O que vai efetivamente sair (ou entrar) na conta, em BRL. Mostrar isso
   * antes de salvar evita o usuário descobrir a conversão depois, no extrato.
   */
  const totalInStored = netTotal;
  const movementBrl = storedCode === "USD" ? totalInStored * usdBrl : totalInStored;
  const conversion =
    storedCode !== "USD"
      ? undefined
      : usdBrl > 0
        ? `US$ ${decimal(totalInStored, 2)} · USDBRL ${fx(usdBrl)}`
        : "Sem cotação do dólar: a operação será recusada.";

  return (
    <Drawer
      title={initial ? "Editar operação" : "Nova operação"}
      subtitle={isCrypto ? "Carteira cripto · em reais ou dólares" : "Bolsa B3 · valores em BRL"}
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
        <Field
          label="Ativo"
          hint={isCrypto ? "Busca na CoinGecko por símbolo ou nome." : "Busca na B3 por ticker ou empresa."}
        >
          {isCrypto ? (
            <CryptoAssetSearch
              selected={asset ? { symbol: asset, name: assetName || asset } : null}
              onSelect={(result: CryptoSearchResult) => {
                setAsset(result.symbol);
                setSlug(result.id);
                setAssetName(result.name);
              }}
              onClear={() => {
                setAsset("");
                setSlug("");
                setAssetName("");
              }}
              autoFocus
            />
          ) : (
            <B3AssetSearch
              selected={asset ? { symbol: asset, name: assetName || asset } : null}
              onSelect={(result) => {
                setAsset(result.symbol);
                setAssetName(result.name);
                if (result.price > 0) editField("unit", String(result.price));
              }}
              onClear={() => {
                setAsset("");
                setAssetName("");
              }}
              autoFocus
            />
          )}
        </Field>
        {/* O campo fica junto do valor, não escondido num avançado (D03): a
            conta é uma escolha do momento da operação. */}
        <CashSourceSelect
          type={type}
          value={source}
          onChange={setSource}
          amountBrl={movementBrl}
          conversion={conversion}
        />

        <Field label="Data">
          <DateField value={date} onChange={setDate} />
        </Field>
        {isCrypto && (
          <div className="eq-currency" role="group" aria-label="Moeda da operação">
            <button
              type="button"
              className={entryCurrency === "USD" ? "active" : ""}
              onClick={() => changeCurrency("USD")}
            >
              USD
            </button>
            <button
              type="button"
              className={entryCurrency === "BRL" ? "active" : ""}
              disabled={!canUseBrl}
              title={canUseBrl ? undefined : "Cotação USD/BRL indisponível"}
              onClick={() => changeCurrency("BRL")}
            >
              BRL
            </button>
          </div>
        )}
        <div className="trade-eq" role="group" aria-label="Quantidade, preço e total">
          <EqTerm
            label="Quantidade"
            value={fields.qty}
            solved={solved === "qty"}
            bumpBy={isCrypto ? 0.001 : 1}
            onChange={(value) => editField("qty", value)}
          />
          <span className="trade-op" aria-hidden>×</span>
          <EqTerm
            label="Preço"
            code={code}
            value={fields.unit}
            solved={solved === "unit"}
            bumpBy={0.01}
            onChange={(value) => editField("unit", value)}
          />
          <span className="trade-op" aria-hidden>=</span>
          <EqTerm
            label="Total"
            code={code}
            value={fields.total}
            solved={solved === "total"}
            bumpBy={0.01}
            onChange={(value) => editField("total", value)}
          />
        </div>
        {isCrypto && (
          <label className="fee-toggle">
            <input type="checkbox" checked={useFee} onChange={(event) => setUseFee(event.target.checked)} />
            <span>Descontar taxa Binance (0,1%)</span>
          </label>
        )}
        <div className="op-preview">
          <div>
            <span>{type === "buy" ? "Você recebe" : "Você vende"}</span>
            <strong>{decimal(netQty, 8)} {asset || "—"}</strong>
            {feeOn && type === "buy" && feeQty > 0 && (
              <small className="op-fee">taxa −{decimal(feeQty, 8)} {asset || ""}</small>
            )}
          </div>
          <div className="right">
            <span>{type === "buy" ? "Você paga" : "Você recebe"}</span>
            <strong>{fmtCurrency(netTotal, code)}</strong>
            {feeOn && type === "sell" && feeTotal > 0 && (
              <small className="op-fee">taxa −{fmtCurrency(feeTotal, code)}</small>
            )}
          </div>
        </div>
      </form>
    </Drawer>
  );
}

type TradeField = "qty" | "unit" | "total";

// Resolve o campo "alvo" a partir dos outros dois (qty × unit = total).
// Retorna "" quando os dois insumos ainda não estão completos.
function solveTrade(target: TradeField, f: Record<TradeField, string>): string {
  const q = Number(f.qty);
  const u = Number(f.unit);
  const t = Number(f.total);
  if (target === "qty") return f.unit !== "" && u > 0 && f.total !== "" ? String(round(t / u)) : "";
  if (target === "unit") return f.qty !== "" && q > 0 && f.total !== "" ? String(round(t / q)) : "";
  return f.qty !== "" && f.unit !== "" && q > 0 ? String(round(q * u)) : "";
}

function EqTerm({
  label,
  code,
  value,
  solved,
  bumpBy = 1,
  onChange
}: {
  label: string;
  code?: string;
  value: string;
  solved: boolean;
  /** Só as setas usam o passo: o campo aceita qualquer precisão. */
  bumpBy?: number;
  onChange: (value: string) => void;
}) {
  function bump(direction: 1 | -1) {
    const delta = bumpBy;
    const next = Math.max(0, round((Number(value) || 0) + direction * delta));
    onChange(String(next));
  }
  return (
    <label className={`eq-term ${solved ? "solved" : ""}`}>
      <span className="eq-label">
        <span className="eq-name">{label}</span>
        {solved ? (
          <span className="eq-auto">
            <Sparkles size={11} /> auto
          </span>
        ) : (
          code && <span className="eq-unit">{code}</span>
        )}
      </span>
      <div className="eq-input">
        <NumberInput
          value={value}
          min="0"
          placeholder="0"
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="eq-step">
          <button type="button" tabIndex={-1} aria-label="Aumentar" onClick={() => bump(1)}>
            <ChevronUp size={12} />
          </button>
          <button type="button" tabIndex={-1} aria-label="Diminuir" onClick={() => bump(-1)}>
            <ChevronDown size={12} />
          </button>
        </span>
      </div>
    </label>
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

const ENTRY_CURRENCY_KEY = "portfolio.entryCurrency";

function readEntryCurrency(): string | null {
  try {
    return localStorage.getItem(ENTRY_CURRENCY_KEY);
  } catch {
    return null;
  }
}

function writeEntryCurrency(value: "USD" | "BRL") {
  try {
    localStorage.setItem(ENTRY_CURRENCY_KEY, value);
  } catch {
    // Sem storage, a moeda só não é lembrada.
  }
}

function round(value: number) {
  return Math.round(value * 1e8) / 1e8;
}

// Taxa padrão de spot da Binance (0,1%).
const BINANCE_FEE = 0.001;

import { ArrowRight, ShoppingCart, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AllocationBoard, type AllocationRow } from "../components/AllocationBoard.js";
import { Button, MiniStat, Panel, SectionHeading } from "../components/ui.js";
import { destinationOf, suggestCashAllocation } from "../lib/cash.js";
import { api } from "../lib/api.js";
import { categoryLabel, money, percent } from "../lib/format.js";
import { useToast } from "../lib/toast.js";
import type { AllocationTarget, Dashboard } from "@projeto41/contracts";

const aliasToCategory: Record<string, string> = {
  dolar: "dollar",
  caixa_br: "cash",
  bolsa_brasil: "b3",
  renda_fixa: "fixed_income",
  acoes_globais: "global"
};

function actualValue(category: string, dashboard: Dashboard) {
  // As classes do livro (prefixo `ledger:`) medem caixa, não carteira: elas
  // nunca entram nos pesos da alocação.
  if (category.startsWith("ledger:")) return 0;
  if (category === "bitcoin") {
    return dashboard.portfolios.crypto.find((asset) => asset.asset === "BTC")?.marketValueBrl ?? 0;
  }
  if (category === "shitcoins") {
    return dashboard.portfolios.crypto
      .filter((asset) => asset.asset !== "BTC")
      .reduce((sum, asset) => sum + asset.marketValueBrl, 0);
  }
  return dashboard.categories[aliasToCategory[category] ?? category] ?? 0;
}

const oneDecimal = (weight: number) => `${(weight * 100).toFixed(1).replace(".", ",")}%`;

export function AllocationPage({
  dashboard,
  onAllocate,
  onOpenCash
}: {
  dashboard: Dashboard;
  /** Leva à tela onde se compra a classe, com a compra aberta quando dá. */
  onAllocate?: (destination: "crypto" | "b3" | "positions") => void;
  onOpenCash?: () => void;
}) {
  const toast = useToast();
  const [targets, setTargets] = useState<AllocationTarget[]>([]);
  const load = useCallback(() => api<AllocationTarget[]>("/allocation").then(setTargets), []);
  useEffect(() => void load(), [load]);

  // `investableBrl` mede só o módulo de investimentos, líquido da reserva. Usar
  // `totalBrl` aqui passaria a incluir conta corrente nos pesos da carteira e
  // distorceria todas as metas.
  const investable = dashboard.investableBrl;

  // Ordenado pelo valor atual (estável durante o arraste do slider).
  const rows = useMemo(
    () =>
      targets
        .map((target) => {
          const actual = actualValue(target.category, dashboard);
          return {
            ...target,
            actual,
            actualWeight: investable > 0 ? actual / investable : 0
          };
        })
        .sort((a, b) => b.actual - a.actual),
    [targets, dashboard, investable]
  );

  // Os caixas (posições Caixa BR) são o dinheiro pronto para ir para a meta.
  // A sugestão reparte ele entre as classes que estão abaixo do alvo, na
  // proporção do que falta a cada uma.
  const brokerCash = dashboard.categories.cash ?? 0;
  const suggestion = useMemo(
    () =>
      suggestCashAllocation(
        rows.map((row) => ({
          category: row.category,
          targetBrl: row.weight * investable,
          actualBrl: row.actual
        })),
        brokerCash
      ),
    [rows, investable, brokerCash]
  );
  const suggested = suggestion.reduce((sum, item) => sum + item.amountBrl, 0);

  const totalWeight = targets.reduce((sum, target) => sum + target.weight, 0);
  const weightOff = Math.abs(totalWeight - 1) > 0.0005;

  const boardRows = useMemo<AllocationRow[]>(
    () =>
      rows.map((row) => ({
        key: row.category,
        label: categoryLabel(row.category),
        detail: `${money(row.actual)} · ${percent(row.actualWeight)} atual`,
        actualWeight: row.actualWeight,
        weight: row.weight
      })),
    [rows]
  );

  function setWeight(category: string, weight: number) {
    setTargets((current) =>
      current.map((target) => (target.category === category ? { ...target, weight } : target))
    );
  }

  async function commit(category: string, weight: number) {
    await api(`/allocation/${category}`, { method: "PUT", body: JSON.stringify({ weight }) });
    toast.notify("Meta atualizada");
  }

  return (
    <div className="allocation">
      <SectionHeading
        title="Alocação ideal"
        subtitle="Compara a estratégia com a carteira atual (reserva excluída)"
      />

      <div className="summary-row">
        <MiniStat label="Total investível" value={money(investable)} />
        <MiniStat label="Em caixa para alocar" value={money(brokerCash)} />
        <MiniStat label="Reserva (fora da meta)" value={money(dashboard.reserveBrl)} />
        <MiniStat
          label={weightOff ? "Soma das metas · ajuste p/ 100%" : "Soma das metas"}
          value={oneDecimal(totalWeight)}
          tone={weightOff ? "negative-text" : "positive-text"}
        />
      </div>

      <Panel
        title="Onde colocar o caixa"
        subtitle={
          brokerCash > 0
            ? "Divide o que está em caixa entre as classes abaixo da meta"
            : "Aporte no caixa da corretora para receber uma sugestão"
        }
        action={
          onOpenCash && (
            <Button variant="ghost" icon={Wallet} onClick={onOpenCash}>
              Em caixa
            </Button>
          )
        }
      >
        {brokerCash <= 0 ? (
          <p className="fin-muted">
            Nada em caixa agora. O dinheiro chega por aporte da conta bancária num caixa, em
            Investimentos › Em caixa, e daqui vai para a classe que está mais longe da meta.
          </p>
        ) : targets.length === 0 ? (
          <p className="fin-muted">
            Defina as metas de cada classe abaixo: a sugestão reparte o caixa entre as que estão
            abaixo do alvo.
          </p>
        ) : suggestion.length === 0 ? (
          <p className="fin-muted">
            Todas as classes estão na meta ou acima dela: o caixa pode ficar onde está.
          </p>
        ) : (
          <>
            <ul className="cash-suggestion">
              {suggestion.map((item) => (
                <li key={item.category}>
                  <span>{categoryLabel(item.category)}</span>
                  <strong>{money(item.amountBrl)}</strong>
                  {onAllocate && (
                    <Button
                      variant="soft"
                      icon={destinationOf(item.category) === "positions" ? ArrowRight : ShoppingCart}
                      onClick={() => onAllocate(destinationOf(item.category))}
                    >
                      Alocar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {brokerCash - suggested > 0.005 && (
              <p className="fin-muted">
                Sobram {money(brokerCash - suggested)} depois de cobrir todas as faltas.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="Real x ideal" subtitle="Arraste o marcador para definir a meta de cada classe">
        <AllocationBoard
          rows={boardRows}
          onChange={setWeight}
          onCommit={commit}
          emptyText="Nenhuma meta de alocação definida."
        />
      </Panel>
    </div>
  );
}

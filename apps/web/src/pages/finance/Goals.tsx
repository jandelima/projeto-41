import { PiggyBank, Plus, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CdiStatus, EntryListResult, EntryRecord, GoalProgress } from "@projeto41/contracts";
import { GoalCard } from "../../components/finance/GoalCard.js";
import { GoalDepositDrawer, type GoalDirection } from "../../components/finance/GoalDepositDrawer.js";
import { GoalDetail } from "../../components/finance/GoalDetail.js";
import { GoalDrawer } from "../../components/finance/GoalDrawer.js";
import { Button, Empty, Kpi, Loading, SectionHeading } from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { longDate, moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

export function GoalsPage() {
  const toast = useToast();
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [cdi, setCdi] = useState<CdiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GoalProgress | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<{ goal: GoalProgress; direction: GoalDirection } | null>(null);
  // O detalhe guarda só o id: depois de guardar ou resgatar, ele mostra a
  // caixinha recarregada, não a cópia de quando abriu.
  const [openId, setOpenId] = useState<number | null>(null);
  const [statement, setStatement] = useState<EntryRecord[] | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const [nextGoals, nextCdi] = await Promise.all([
        api<GoalProgress[]>("/ledger/goals"),
        api<CdiStatus>("/cdi/status")
      ]);
      setGoals(nextGoals);
      setCdi(nextCdi);
      setVersion((current) => current + 1);
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao carregar", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (openId == null) return;
    let alive = true;
    api<EntryListResult>(`/ledger/goals/${openId}/entries?pageSize=200`)
      .then((result) => alive && setStatement(result.rows))
      .catch(() => alive && setStatement([]));
    return () => {
      alive = false;
    };
  }, [openId, version]);

  const opened = goals.find((goal) => goal.id === openId) ?? null;

  const totals = useMemo(
    () => ({
      saved: goals.reduce((sum, goal) => sum + goal.balanceCents, 0),
      yielding: goals
        .filter((goal) => goal.cdiPercent != null)
        .reduce((sum, goal) => sum + goal.balanceCents, 0),
      realized: goals.reduce((sum, goal) => sum + goal.realizedYieldCents, 0),
      projected: goals.reduce((sum, goal) => sum + goal.projectedYieldCents, 0)
    }),
    [goals]
  );

  /**
   * Troca a caixinha de lugar com a vizinha. A tela muda na hora; se gravar
   * falhar, volta para a ordem do servidor.
   */
  async function move(index: number, step: -1 | 1) {
    const target = index + step;
    if (target < 0 || target >= goals.length) return;
    const next = [...goals];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setGoals(next);
    try {
      await api("/ledger/goals/order", {
        method: "PUT",
        body: JSON.stringify({ ids: next.map((goal) => goal.id) })
      });
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar a ordem", "error");
      await load();
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <SectionHeading title="Caixinhas" subtitle="Dinheiro separado com objetivo">
        <Button icon={Plus} onClick={() => setCreating(true)}>
          Nova caixinha
        </Button>
      </SectionHeading>

      <div className="fin-summary">
        <Kpi icon={PiggyBank} label="Total guardado" value={moneyFromCents(totals.saved)} />
        <Kpi icon={Wallet} label="Rendendo" value={moneyFromCents(totals.yielding)} />
        {/* Realizado e projetado em elementos separados, nunca num número só. */}
        <Kpi
          icon={TrendingUp}
          label="Rendimento realizado"
          value={moneyFromCents(totals.realized)}
          detail={cdi?.lastDate ? `CDI até ${longDate(cdi.lastDate)}` : undefined}
        />
        <Kpi
          icon={Sparkles}
          label="Projeção"
          value={moneyFromCents(totals.projected)}
          detail="repetindo o último fator conhecido"
        />
      </div>

      {cdi && cdi.staleDays != null && cdi.staleDays > 3 && (
        <p className="fin-warning">
          {/* `online: false` significa "a última tentativa falhou", não que o
              app esteja sem rede agora — dizer a segunda coisa seria alarmar
              sem base. */}
          CDI atualizado até {longDate(cdi.lastDate!)}
          {!cdi.online && " · a última tentativa de atualizar não completou"}. O rendimento
          realizado vai até essa data; o resto aparece como projeção.
        </p>
      )}

      {goals.length === 0 ? (
        <Empty icon={PiggyBank} text="Nenhuma caixinha ainda." />
      ) : (
        <div className="fin-goal-grid">
          {goals.map((goal, index) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onReorder={
                goals.length > 1
                  ? {
                      back: index > 0 ? () => void move(index, -1) : undefined,
                      forward: index < goals.length - 1 ? () => void move(index, 1) : undefined
                    }
                  : undefined
              }
              onOpen={() => {
                setStatement(null);
                setOpenId(goal.id);
              }}
              onMove={(direction) => setMoving({ goal, direction })}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <GoalDrawer
          goal={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await load();
          }}
        />
      )}

      {opened && (
        <GoalDetail
          goal={opened}
          rows={statement}
          cdiThrough={cdi?.lastDate ?? null}
          onAction={(direction) => setMoving({ goal: opened, direction })}
          onEdit={() => setEditing(opened)}
          onClose={() => setOpenId(null)}
        />
      )}

      {moving && (
        <GoalDepositDrawer
          goal={moving.goal}
          initialDirection={moving.direction}
          onClose={() => setMoving(null)}
          onDone={async () => {
            setMoving(null);
            await load();
          }}
        />
      )}
    </>
  );
}

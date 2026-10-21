import { Archive, Plus, Save, Tags, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CategoryKind, CategoryRecord, TagRecord } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { ColorDot, ColorPicker } from "../../components/ColorPicker.js";
import { Drawer, useConfirm } from "../../components/dialog.js";
import {
  Button,
  Empty,
  Field,
  IconButton,
  Loading,
  Panel,
  SectionHeading,
  Segmented
} from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { centsToInput, moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";
import { MoneyInput } from "../../components/forms.js";

/**
 * Categorias planas, saidas e entradas lado a lado (D05).
 *
 * Nao existe subcategoria: os cortes transversais sao cobertos pelas etiquetas,
 * que ficam na terceira coluna. Categoria em uso e arquivada, nunca excluida,
 * para nao quebrar relatorio antigo.
 */

type Draft = Partial<CategoryRecord>;

type GoalMode = "none" | "absolute" | "share";

/** `250` -> `"25%"`, `125` -> `"12,5%"`. */
function shareLabel(perMille: number) {
  return `${(perMille / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** O objetivo como o usuario o definiu, para a lista. Sem objetivo, nada (6.5). */
function goalLabel(category: CategoryRecord): string | null {
  if (category.budgetSharePerMille != null) return `${shareLabel(category.budgetSharePerMille)} dos gastos`;
  if (category.monthlyBudgetCents != null) return `${moneyFromCents(category.monthlyBudgetCents)}/mês`;
  return null;
}

export function CategoriesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [editingTag, setEditingTag] = useState<Partial<TagRecord> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [nextCategories, nextTags] = await Promise.all([
      api<CategoryRecord[]>("/ledger/categories"),
      api<TagRecord[]>("/ledger/tags")
    ]);
    setCategories(nextCategories);
    setTags(nextTags);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load().catch((error: Error) => {
      toast.notify(error.message, "error");
      setLoading(false);
    });
  }, [load, toast]);

  async function archive(category: CategoryRecord) {
    const ok = await confirm({
      title: "Arquivar categoria",
      message: `"${category.name}" some das listas. Os lançamentos já classificados continuam nela.`,
      confirmLabel: "Arquivar"
    });
    if (!ok) return;
    await api(`/ledger/categories/${category.id}`, { method: "DELETE" });
    toast.notify("Categoria arquivada");
    await load();
  }

  /** Excluir de vez: os lançamentos ficam, sem categoria. */
  async function purge(category: CategoryRecord) {
    const ok = await confirm({
      title: "Excluir categoria de vez",
      message: `"${category.name}" será apagada. Os lançamentos que estavam nela continuam, mas ficam sem categoria. Não dá para desfazer.`,
      confirmLabel: "Excluir de vez",
      tone: "danger"
    });
    if (!ok) return;
    try {
      const result = await api<{ entries?: number }>(`/ledger/categories/${category.id}?purge=1`, {
        method: "DELETE"
      });
      toast.notify(
        result.entries
          ? `Categoria excluída · ${result.entries} lançamento${result.entries === 1 ? "" : "s"} sem categoria`
          : "Categoria excluída"
      );
      await load();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao excluir", "error");
    }
  }

  async function removeTag(tag: TagRecord) {
    const ok = await confirm({
      title: "Excluir etiqueta",
      message: `"${tag.name}" sai dos lançamentos que a usam. Os lançamentos continuam intactos.`,
      confirmLabel: "Excluir",
      tone: "danger"
    });
    if (!ok) return;
    await api(`/ledger/tags/${tag.id}`, { method: "DELETE" });
    toast.notify("Etiqueta excluída");
    await load();
  }

  if (loading) return <Loading />;

  const columns: { kind: CategoryKind; title: string; subtitle: string }[] = [
    { kind: "expense", title: "Saídas", subtitle: "Para onde o dinheiro vai" },
    { kind: "income", title: "Entradas", subtitle: "De onde o dinheiro vem" }
  ];

  return (
    <>
      <SectionHeading title="Categorias" subtitle="Categorias planas e etiquetas livres">
        <Button icon={Plus} onClick={() => setEditing({ kind: "expense", color: "#4f8ff7" })}>
          Nova categoria
        </Button>
      </SectionHeading>

      <div className="fin-columns">
        {columns.map((column) => {
          // Em ordem alfabética, sem diferenciar acento nem maiúscula ("Água" junto do "A").
          const items = categories
            .filter((category) => category.kind === column.kind)
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
          return (
            <Panel key={column.kind} title={column.title} subtitle={column.subtitle}>
              {items.length === 0 && <Empty icon={Tags} text="Nenhuma categoria." />}
              {/* Altura limitada: com dezenas de categorias a tela não cresce
                  sem fim, a lista rola dentro do painel. */}
              <div className="fin-scroll">
                <ul className="fin-list">
                  {items.map((category) => {
                    const goal = goalLabel(category);
                    return (
                      <li key={category.id}>
                        <button className="fin-link" onClick={() => setEditing(category)}>
                          <ColorDot color={category.color} />
                          {category.name}
                        </button>
                        <span className="fin-list-meta">
                          {/* Sem objetivo não mostra placeholder nenhum (6.5). */}
                          {goal && <small className="fin-budget">{goal}</small>}
                          <IconButton
                            icon={Archive}
                            label="Arquivar"
                            onClick={() => void archive(category)}
                          />
                          <IconButton
                            icon={Trash2}
                            tone="danger"
                            label={`Excluir ${category.name} de vez`}
                            onClick={() => void purge(category)}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Panel>
          );
        })}

        <Panel
          title="Etiquetas"
          subtitle="Cortes transversais, múltiplos por lançamento"
          action={
            <Button variant="ghost" icon={Plus} onClick={() => setEditingTag({ color: "#8b949e" })}>
              Nova
            </Button>
          }
        >
          {tags.length === 0 && <Empty icon={Tags} text="Nenhuma etiqueta." />}
          <div className="fin-scroll">
            <ul className="fin-list">
              {tags.map((tag) => (
                <li key={tag.id}>
                  <button className="fin-link" onClick={() => setEditingTag(tag)}>
                    <ColorDot color={tag.color} />
                    {tag.name}
                  </button>
                  <IconButton icon={Trash2} tone="danger" label="Excluir" onClick={() => void removeTag(tag)} />
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      {editing && (
        <CategoryDrawer
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {editingTag && (
        <TagDrawer
          initial={editingTag}
          onClose={() => setEditingTag(null)}
          onSaved={async () => {
            setEditingTag(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function CategoryDrawer({
  initial,
  onClose,
  onSaved
}: {
  initial: Draft;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(initial.kind ?? "expense");
  const [color, setColor] = useState(initial.color ?? "#4f8ff7");
  const [mode, setMode] = useState<GoalMode>(
    initial.budgetSharePerMille != null
      ? "share"
      : initial.monthlyBudgetCents != null
        ? "absolute"
        : "none"
  );
  const [budget, setBudget] = useState(
    initial.monthlyBudgetCents != null ? centsToInput(initial.monthlyBudgetCents) : ""
  );
  const [share, setShare] = useState(
    initial.budgetSharePerMille != null
      ? (initial.budgetSharePerMille / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })
      : ""
  );
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    let monthlyBudgetCents: number | null = null;
    let budgetSharePerMille: number | null = null;
    if (mode === "absolute") {
      monthlyBudgetCents = parseCurrencyInput(budget);
      if (monthlyBudgetCents == null || monthlyBudgetCents < 0) {
        toast.notify("Objetivo em valor inválido", "error");
        return;
      }
    }
    if (mode === "share") {
      // `parseCurrencyInput` lê "12,5" como 1250 centésimos: dividido por 10
      // vira 125 milésimos, que é 12,5%. Reaproveita o parser pt-BR do app.
      const hundredths = parseCurrencyInput(share);
      if (hundredths == null || hundredths < 0 || hundredths > 10000) {
        toast.notify("O percentual precisa estar entre 0 e 100", "error");
        return;
      }
      budgetSharePerMille = Math.round(hundredths / 10);
    }
    setSaving(true);
    try {
      const body = { name, kind, color, monthlyBudgetCents, budgetSharePerMille };
      if (initial.id) {
        await api(`/ledger/categories/${initial.id}`, {
          method: "PUT",
          body: JSON.stringify(body)
        });
      } else {
        await api("/ledger/categories", { method: "POST", body: JSON.stringify(body) });
      }
      toast.notify("Categoria salva");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={initial.id ? "Editar categoria" : "Nova categoria"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="category-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="category-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            placeholder="Ex.: Mercado"
          />
        </Field>
        <Field label="Tipo">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as CategoryKind)}
            disabled={Boolean(initial.id)}
          >
            <option value="expense">Saída</option>
            <option value="income">Entrada</option>
          </select>
        </Field>
        <Field
          label="Objetivo de gasto"
          hint={
            mode === "share"
              ? "Fração do total de saídas do período. Acompanha qualquer recorte de datas."
              : mode === "absolute"
                ? "Quanto a categoria pode gastar por mês."
                : "Sem objetivo, a categoria só aparece nos totais."
          }
        >
          <Segmented<GoalMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "none", label: "Sem objetivo" },
              { value: "absolute", label: "Valor" },
              { value: "share", label: "% dos gastos" }
            ]}
          />
        </Field>
        {mode === "absolute" && (
          <Field label="Valor por mês">
            <MoneyInput
              value={budget}
              onChange={setBudget}
              placeholder="0,00"
              required
            />
          </Field>
        )}
        {mode === "share" && (
          <Field label="Percentual dos gastos">
            <div className="input-suffix">
              <input
                value={share}
                onChange={(event) => setShare(event.target.value)}
                inputMode="decimal"
                placeholder="25"
                required
              />
              <span>%</span>
            </div>
          </Field>
        )}
        <ColorPicker value={color} onChange={setColor} />
      </form>
    </Drawer>
  );
}

function TagDrawer({
  initial,
  onClose,
  onSaved
}: {
  initial: Partial<TagRecord>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial.name ?? "");
  const [color, setColor] = useState(initial.color ?? "#8b949e");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = { name, color };
      if (initial.id) {
        await api(`/ledger/tags/${initial.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/ledger/tags", { method: "POST", body: JSON.stringify(body) });
      }
      toast.notify("Etiqueta salva");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={initial.id ? "Editar etiqueta" : "Nova etiqueta"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="tag-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="tag-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            placeholder="Ex.: viagem"
          />
        </Field>
        <ColorPicker value={color} onChange={setColor} />
      </form>
    </Drawer>
  );
}

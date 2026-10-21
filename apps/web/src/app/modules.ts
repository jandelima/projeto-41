import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  ChartPie,
  Coins,
  CreditCard,
  FileUp,
  Gauge,
  History,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  ReceiptText,
  Scale,
  SlidersHorizontal,
  Tags,
  Target,
  TrendingUp,
  Wallet
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * O app tem dois módulos, com perguntas diferentes:
 *
 * - **Investimentos** — quanto a carteira vale, como está distribuída e para
 *   onde vai o próximo aporte. Vive de cotações.
 * - **Finanças** — de onde vem e para onde vai o dinheiro do dia a dia: contas,
 *   gastos, faturas e orçamento. Vive de lançamentos.
 *
 * Misturar os dois num menu só deixava telas homônimas lado a lado ("Alocação"
 * e "Alocação de gastos") e o ticker de cotações em cima da fatura do cartão.
 * Cada tela pertence a exatamente um módulo; o seletor troca o menu inteiro.
 */

export type ModuleId = "investments" | "finance";

export type Page =
  | "dashboard"
  | "crypto"
  | "b3"
  | "positions"
  | "investment-cash"
  | "contributions"
  | "planning"
  | "allocation"
  | "history"
  | "finance"
  | "reports"
  | "invoice"
  | "networth"
  | "goals"
  | "transactions"
  | "expenses"
  | "income"
  | "accounts"
  | "categories"
  | "spending-allocation"
  | "import";

type Icon = ComponentType<{ size?: number | string }>;

export type NavItem = { id: Page; label: string; icon: Icon };

export type AppModule = {
  id: ModuleId;
  label: string;
  /** O que o módulo responde, em uma linha: aparece sob o seletor. */
  tagline: string;
  icon: Icon;
  home: Page;
  groups: { group: string; items: NavItem[] }[];
};

export const modules: AppModule[] = [
  {
    id: "investments",
    label: "Investimentos",
    tagline: "Carteira, cotações e metas de alocação",
    icon: TrendingUp,
    home: "dashboard",
    groups: [
      {
        group: "Resumo",
        items: [{ id: "dashboard", label: "Visão geral", icon: LayoutDashboard }]
      },
      {
        group: "Carteiras",
        items: [
          { id: "investment-cash", label: "Em caixa", icon: Banknote },
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
          { id: "allocation", label: "Alocação da carteira", icon: Target },
          { id: "history", label: "Histórico", icon: History }
        ]
      }
    ]
  },
  {
    id: "finance",
    label: "Finanças",
    tagline: "Contas, gastos, faturas e orçamento",
    icon: Landmark,
    home: "finance",
    groups: [
      {
        group: "Resumo",
        items: [
          { id: "finance", label: "Painel", icon: Gauge },
          { id: "reports", label: "Relatórios", icon: ChartPie },
          { id: "networth", label: "Patrimônio", icon: Scale }
        ]
      },
      {
        group: "Movimentações",
        items: [
          { id: "transactions", label: "Transações", icon: ReceiptText },
          { id: "expenses", label: "Gastos", icon: ArrowDownCircle },
          { id: "income", label: "Entradas", icon: ArrowUpCircle },
          { id: "invoice", label: "Fatura", icon: CreditCard },
          { id: "import", label: "Importar extrato", icon: FileUp }
        ]
      },
      {
        group: "Orçamento",
        items: [
          { id: "categories", label: "Categorias", icon: Tags },
          { id: "spending-allocation", label: "Alocação de gastos", icon: SlidersHorizontal },
          { id: "goals", label: "Caixinhas", icon: PiggyBank }
        ]
      },
      {
        group: "Cadastros",
        items: [{ id: "accounts", label: "Contas e pessoas", icon: Landmark }]
      }
    ]
  }
];

export const moduleById = (id: ModuleId): AppModule =>
  modules.find((module) => module.id === id)!;

export function moduleOf(page: Page): AppModule {
  return modules.find((module) => module.groups.some((g) => g.items.some((i) => i.id === page)))!;
}

export function navItem(page: Page): NavItem {
  return moduleOf(page)
    .groups.flatMap((group) => group.items)
    .find((item) => item.id === page)!;
}

const pageIn = (module: AppModule, page: unknown): page is Page =>
  module.groups.some((group) => group.items.some((item) => item.id === page));

/*
 * Lembrar a última tela de cada módulo é conveniência deste navegador, não
 * dado: qualquer falha de armazenamento cai na tela inicial do módulo.
 */
const MODULE_KEY = "projeto41-module";
const pageKey = (id: ModuleId) => `projeto41-page:${id}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento a navegação só não é lembrada.
  }
}

/** A tela em que o módulo reabre: a última visitada nele, ou a inicial. */
export function lastPageOf(id: ModuleId): Page {
  const module = moduleById(id);
  const stored = read(pageKey(id));
  return pageIn(module, stored) ? stored : module.home;
}

export function initialPage(): Page {
  const stored = read(MODULE_KEY);
  return lastPageOf(stored === "finance" ? "finance" : "investments");
}

export function rememberPage(page: Page) {
  const module = moduleOf(page);
  write(MODULE_KEY, module.id);
  write(pageKey(module.id), page);
}

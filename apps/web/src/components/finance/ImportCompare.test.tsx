// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportCandidate, ImportRowView } from "@projeto41/contracts";
import { CandidatePicker, ImportCompare, linkChanges } from "./ImportCompare.js";

afterEach(cleanup);

const candidate = (overrides: Partial<ImportCandidate> = {}): ImportCandidate => ({
  entryId: 7,
  reason: "fuzzy_amount_date",
  confidence: "likely",
  dayDistance: 0,
  date: "2026-10-01",
  amountCents: -1900,
  kind: "expense",
  status: "cleared",
  description: "Lanche",
  placeName: null,
  categoryName: "Alimentação",
  personName: "Steylor",
  transferWith: null,
  installment: null,
  reconciled: false,
  blocked: null,
  ...overrides
});

const row = (overrides: Partial<ImportRowView> = {}): ImportRowView =>
  ({
    id: 1,
    lineNo: 1,
    status: "needs_review",
    date: "2026-10-01",
    time: "16:01",
    amountCents: -1900,
    rawDescription: "Transferência enviada pelo Pix - Zelia Almeida",
    paymentMethod: "pix",
    installment: null,
    statementMonth: null,
    payee: { key: "name:zelia almeida", display: "Zelia Almeida", document: null },
    suggestion: { kind: "expense", categoryId: null, placeName: null, description: null, personId: null },
    rule: null,
    duplicate: null,
    alternatives: [],
    entryId: null,
    skippedBefore: false,
    ...overrides
  }) as ImportRowView;

describe("linkChanges", () => {
  it("nao muda nada quando os dois lados batem", () => {
    expect(linkChanges(row(), candidate())).toEqual([]);
  });

  it("avisa valor, dia e o previsto que vira confirmado", () => {
    const changes = linkChanges(
      row({ date: "2026-10-01", amountCents: -1900 }),
      candidate({ date: "2026-10-04", amountCents: -1890, status: "pending" })
    );
    expect(changes).toHaveLength(3);
    expect(changes[0]).toMatch(/o valor passa de/);
    expect(changes[1]).toMatch(/o dia passa de/);
    expect(changes[2]).toMatch(/previsto/);
  });

  it("parcela mantem o dia do plano", () => {
    const changes = linkChanges(
      row({ date: "2026-10-03" }),
      candidate({ date: "2026-10-01", installment: { number: 3, total: 4 } })
    );
    expect(changes.some((change) => /o dia passa/.test(change))).toBe(false);
  });
});

describe("ImportCompare", () => {
  it("mostra o arquivo e o livro lado a lado", () => {
    render(<ImportCompare row={row()} candidate={candidate()} />);
    expect(screen.getByRole("columnheader", { name: "No arquivo" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "No livro" })).toBeInTheDocument();
    expect(screen.getByText("Zelia Almeida")).toBeInTheDocument();
    expect(screen.getByText(/Lanche/)).toBeInTheDocument();
    expect(screen.getByText("Muito provável")).toBeInTheDocument();
    expect(screen.getByText(/fica como está/)).toBeInTheDocument();
  });

  it("marca o que difere", () => {
    render(<ImportCompare row={row()} candidate={candidate({ date: "2026-10-04", dayDistance: 3 })} />);
    expect(screen.getByText("Dia").closest("tr")).toHaveClass("differs");
    expect(screen.getByText("Valor").closest("tr")).not.toHaveClass("differs");
    expect(screen.getByText(/3 dias de diferença/)).toBeInTheDocument();
    // Uma data abreviada ja termina em ponto: a frase nao pode dobrar o ponto.
    expect(screen.getByText(/Ao vincular/).textContent).not.toMatch(/\.\./);
  });

  it("mostra o motivo quando nao da para vincular", () => {
    render(<ImportCompare row={row()} candidate={candidate({ blocked: "Lançamento conciliado não pode ser alterado pela importação" })} />);
    expect(screen.getByText(/conciliado não pode/)).toBeInTheDocument();
    expect(screen.queryByText(/Ao vincular/)).toBeNull();
  });
});

describe("CandidatePicker", () => {
  it("so aparece quando ha mais de um candidato", () => {
    const { container } = render(
      <CandidatePicker row={row()} candidates={[candidate()]} value={7} onChange={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("troca o candidato escolhido", () => {
    const onChange = vi.fn();
    render(
      <CandidatePicker
        row={row()}
        candidates={[candidate(), candidate({ entryId: 9, description: "Outro lanche", confidence: "possible" })]}
        value={7}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: /Outro lanche/ }));
    expect(onChange).toHaveBeenCalledWith(9);
  });
});

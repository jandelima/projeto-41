// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Dropdown } from "./forms.js";
import { Field } from "./ui.js";

afterEach(cleanup);

const OPTIONS = [
  { value: 1, label: "Alimentação" },
  { value: 2, label: "Casa" }
];

function Single() {
  const [value, setValue] = useState<number | null>(null);
  return (
    // O Field e um <label>: e ali dentro que o dropdown vive no app inteiro.
    <Field label="Categoria">
      <Dropdown<number> value={value} onChange={setValue} options={OPTIONS} aria-label="Categoria" />
    </Field>
  );
}

function Multi() {
  const [value, setValue] = useState<number[]>([]);
  return (
    <Field label="Etiquetas">
      <Dropdown<number> multiple value={value} onChange={setValue} options={OPTIONS} aria-label="Etiquetas" />
    </Field>
  );
}

describe("Dropdown dentro de um Field", () => {
  it("fecha ao escolher uma opcao", () => {
    render(<Single />);
    fireEvent.click(screen.getByRole("button", { name: "Categoria" }));
    fireEvent.click(screen.getByRole("option", { name: "Casa" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Categoria" })).toHaveTextContent("Casa");
  });

  it("na escolha multipla continua aberto para marcar mais de uma", () => {
    render(<Multi />);
    fireEvent.click(screen.getByRole("button", { name: "Etiquetas" }));
    fireEvent.click(screen.getByRole("option", { name: "Casa" }));
    fireEvent.click(screen.getByRole("option", { name: "Alimentação" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option", { selected: true })).toHaveLength(2);
  });
});

import type Database from "better-sqlite3";
import { createDatabase } from "./index.js";

/**
 * Banco em memoria para teste, com as tres pessoas que as versoes antigas
 * semeavam, nos mesmos ids.
 *
 * O app real comeca sem ninguem (o usuario cria as pessoas antes das contas),
 * mas a maior parte dos testes do livro nao e sobre pessoas: e sobre saldo,
 * fatura e alvo, e precisa de alguem dono da conta. Semear aqui, explicitamente,
 * e mais honesto que cada teste fingir que o banco ja vem povoado.
 */
export const TEST_PEOPLE = [
  { id: 1, name: "Steylor", kind: "individual", color: "#4f9cf9" },
  { id: 2, name: "Bianca", kind: "individual", color: "#f97ab0" },
  { id: 3, name: "Conjunto", kind: "joint", color: "#7c5cff" }
] as const;

/** Semeia `TEST_PEOPLE` num banco ja migrado ate pelo menos a 002. */
export function seedTestPeople(raw: Database.Database) {
  const insert = raw.prepare(
    "INSERT INTO people(id, name, kind, color, active, created_at) VALUES (?, ?, ?, ?, 1, ?)"
  );
  const now = new Date().toISOString();
  for (const person of TEST_PEOPLE) {
    insert.run(person.id, person.name, person.kind, person.color, now);
  }
}

export function createTestDatabase() {
  const db = createDatabase(":memory:");
  seedTestPeople(db.raw);
  return db;
}

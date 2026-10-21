import type { PersonDraft, PersonRecord } from "@projeto41/contracts";
import { countBlockingReferences, fromBit, notFound, nowIso, toBit, type Db } from "./shared.js";

type PersonRow = {
  id: number;
  name: string;
  kind: "individual" | "joint";
  color: string;
  active: number;
};

const SELECT = "SELECT id, name, kind, color, active FROM people";

const map = (row: PersonRow): PersonRecord => ({
  ...row,
  active: fromBit(row.active)
});

export function createPeopleRepository(db: Db) {
  return {
    list: (includeInactive = true): PersonRecord[] =>
      (
        db
          .prepare(`${SELECT} ${includeInactive ? "" : "WHERE active = 1"} ORDER BY id`)
          .all() as PersonRow[]
      ).map(map),

    get: (id: number): PersonRecord | undefined => {
      const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as PersonRow | undefined;
      return row ? map(row) : undefined;
    },

    create: (person: PersonDraft): number =>
      Number(
        db
          .prepare(
            `INSERT INTO people(name, kind, color, active, created_at)
             VALUES (@name, @kind, @color, @active, @createdAt)`
          )
          .run({
            name: person.name,
            kind: person.kind,
            color: person.color,
            active: toBit(person.active, true),
            createdAt: nowIso()
          }).lastInsertRowid
      ),

    update: (id: number, person: PersonDraft): number => {
      const changes = db
        .prepare(
          `UPDATE people SET name=@name, kind=@kind, color=@color, active=@active WHERE id=@id`
        )
        .run({
          id,
          name: person.name,
          kind: person.kind,
          color: person.color,
          active: toBit(person.active, true)
        }).changes;
      if (changes === 0) throw notFound("Pessoa");
      return changes;
    },

    /** Arquivar preserva o historico; e o caminho padrao para pessoa em uso. */
    archive: (id: number): number => {
      const changes = db.prepare("UPDATE people SET active = 0 WHERE id = ?").run(id).changes;
      if (changes === 0) throw notFound("Pessoa");
      return changes;
    },

    /** So apaga de verdade quem nunca foi usado; caso contrario, arquive. */
    remove: (id: number): number => {
      const used = countBlockingReferences(db, "people", id);
      if (used > 0) {
        db.prepare("UPDATE people SET active = 0 WHERE id = ?").run(id);
        return 0;
      }
      const changes = db.prepare("DELETE FROM people WHERE id = ?").run(id).changes;
      if (changes === 0) throw notFound("Pessoa");
      return changes;
    }
  };
}

import type { TagDraft, TagRecord } from "@projeto41/contracts";
import { countReferencing, notFound, type Db } from "./shared.js";

const SELECT = "SELECT id, name, color FROM tags";

export function createTagsRepository(db: Db) {
  return {
    list: (): TagRecord[] => db.prepare(`${SELECT} ORDER BY name`).all() as TagRecord[],

    get: (id: number): TagRecord | undefined =>
      db.prepare(`${SELECT} WHERE id = ?`).get(id) as TagRecord | undefined,

    create: (tag: TagDraft): number =>
      Number(
        db.prepare("INSERT INTO tags(name, color) VALUES (@name, @color)").run({
          name: tag.name,
          color: tag.color
        }).lastInsertRowid
      ),

    /** Etiqueta e livre e multipla (D05): a UI cria na hora, pelo nome. */
    findOrCreate: (name: string, color = "#8b949e"): number => {
      const existing = db
        .prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE")
        .get(name.trim()) as { id: number } | undefined;
      if (existing) return existing.id;
      return Number(
        db.prepare("INSERT INTO tags(name, color) VALUES (?, ?)").run(name.trim(), color)
          .lastInsertRowid
      );
    },

    update: (id: number, tag: TagDraft): number => {
      const changes = db
        .prepare("UPDATE tags SET name=@name, color=@color WHERE id=@id")
        .run({ id, name: tag.name, color: tag.color }).changes;
      if (changes === 0) throw notFound("Etiqueta");
      return changes;
    },

    /**
     * Etiqueta nao tem versao arquivada: remover desfaz so o vinculo, e o
     * lancamento continua intacto. Por isso aqui o delete e sempre real.
     */
    remove: (id: number): number => {
      const changes = db.prepare("DELETE FROM tags WHERE id = ?").run(id).changes;
      if (changes === 0) throw notFound("Etiqueta");
      return changes;
    },

    usageCount: (id: number): number =>
      countReferencing(db, "SELECT COUNT(*) AS n FROM entry_tags WHERE tag_id = ?", id)
  };
}

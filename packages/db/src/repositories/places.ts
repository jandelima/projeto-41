import type { PlaceDraft, PlaceRecord } from "@projeto41/contracts";
import { normalizeName } from "@projeto41/finance";
import { countBlockingReferences, notFound, nowIso, type Db } from "./shared.js";

const SELECT = `
  SELECT id, name, normalized_name AS normalizedName,
         default_category_id AS defaultCategoryId, notes
  FROM places
`;

export function createPlacesRepository(db: Db) {
  const repository = {
    list: (search?: string): PlaceRecord[] => {
      if (!search) {
        return db.prepare(`${SELECT} ORDER BY name`).all() as PlaceRecord[];
      }
      // A busca usa a chave normalizada, entao digitar "assai" acha "Assaí".
      return db
        .prepare(`${SELECT} WHERE normalized_name LIKE ? ORDER BY name LIMIT 50`)
        .all(`%${normalizeName(search)}%`) as PlaceRecord[];
    },

    get: (id: number): PlaceRecord | undefined =>
      db.prepare(`${SELECT} WHERE id = ?`).get(id) as PlaceRecord | undefined,

    getByName: (name: string): PlaceRecord | undefined =>
      db.prepare(`${SELECT} WHERE normalized_name = ?`).get(normalizeName(name)) as
        PlaceRecord | undefined,

    create: (place: PlaceDraft): number => {
      const normalized = normalizeName(place.name);
      if (!normalized) throw notFound("Local");
      return Number(
        db
          .prepare(
            `INSERT INTO places(name, normalized_name, default_category_id, notes, created_at)
             VALUES (@name, @normalizedName, @defaultCategoryId, @notes, @createdAt)`
          )
          .run({
            name: place.name,
            normalizedName: normalized,
            defaultCategoryId: place.defaultCategoryId ?? null,
            notes: place.notes ?? null,
            createdAt: nowIso()
          }).lastInsertRowid
      );
    },

    /**
     * Ponto de entrada unico para resolver um local pelo nome, usado tanto pela
     * UI quanto pela importacao da fase 6. "Assaí", "assai" e "ASSAI" resolvem
     * para o mesmo registro (D06).
     */
    findOrCreate: (name: string, defaultCategoryId?: number | null): number => {
      const existing = repository.getByName(name);
      if (existing) return existing.id;
      return repository.create({
        name: name.trim(),
        defaultCategoryId: defaultCategoryId ?? null
      });
    },

    update: (id: number, place: PlaceDraft): number => {
      const changes = db
        .prepare(
          `UPDATE places SET name=@name, normalized_name=@normalizedName,
           default_category_id=@defaultCategoryId, notes=@notes WHERE id=@id`
        )
        .run({
          id,
          name: place.name,
          normalizedName: normalizeName(place.name),
          defaultCategoryId: place.defaultCategoryId ?? null,
          notes: place.notes ?? null
        }).changes;
      if (changes === 0) throw notFound("Local");
      return changes;
    },

    /** Local em uso nao e removido: ele e a ponte com o historico e a importacao. */
    remove: (id: number): number => {
      const used = countBlockingReferences(db, "places", id);
      if (used > 0) return 0;
      const changes = db.prepare("DELETE FROM places WHERE id = ?").run(id).changes;
      if (changes === 0) throw notFound("Local");
      return changes;
    }
  };

  return repository;
}

import Database from "better-sqlite3";
import type { Contribution, ManualPosition, Operation } from "@projeto41/contracts";

type SnapshotInput = {
  date: string;
  totalBrl: number;
  payload: Record<string, number>;
  priceTimes?: Record<string, string>;
};

export type PriceRecord = {
  symbol: string;
  currency: "BRL" | "USD";
  price: number;
  provider: string;
  marketTime: string | null;
  fetchedAt: string;
  error: string | null;
};

export type CryptoAsset = {
  symbol: string;
  slug: string;
  name: string;
};

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(path: string) {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  migrate(raw);

  return {
    raw,
    close: () => raw.close(),
    transaction: <T>(callback: () => T) => raw.transaction(callback)(),
    operations: {
      list: (portfolio?: string) =>
        raw
          .prepare(
            `SELECT id, portfolio, type, asset, date, quantity, total, currency, notes
             FROM operations
             ${portfolio ? "WHERE portfolio = ?" : ""}
             ORDER BY date DESC, id DESC`
          )
          .all(...(portfolio ? [portfolio] : [])) as (Operation & { id: number })[],
      create: (operation: Operation) => {
        const result = raw
          .prepare(
            `INSERT INTO operations
             (portfolio, type, asset, date, quantity, total, currency, notes)
             VALUES (@portfolio, @type, @asset, @date, @quantity, @total, @currency, @notes)`
          )
          .run({ notes: null, ...operation });
        return Number(result.lastInsertRowid);
      },
      update: (id: number, operation: Operation) =>
        raw
          .prepare(
            `UPDATE operations SET portfolio=@portfolio, type=@type, asset=@asset,
             date=@date, quantity=@quantity, total=@total, currency=@currency, notes=@notes
             WHERE id=@id`
          )
          .run({ notes: null, ...operation, id }).changes,
      remove: (id: number) => raw.prepare("DELETE FROM operations WHERE id = ?").run(id).changes
    },
    cryptoAssets: {
      list: () =>
        raw
          .prepare("SELECT symbol, slug, name FROM crypto_assets ORDER BY symbol")
          .all() as CryptoAsset[],
      get: (symbol: string) =>
        raw
          .prepare("SELECT symbol, slug, name FROM crypto_assets WHERE symbol = ?")
          .get(symbol) as CryptoAsset | undefined,
      upsert: (asset: CryptoAsset) =>
        raw
          .prepare(
            `INSERT INTO crypto_assets(symbol, slug, name) VALUES (@symbol, @slug, @name)
             ON CONFLICT(symbol) DO UPDATE SET slug=excluded.slug, name=excluded.name`
          )
          .run(asset)
    },
    positions: {
      list: () =>
        raw
          .prepare(
            `SELECT id, category, name, invested, current_value AS currentValue,
             currency, notes FROM manual_positions ORDER BY category, id`
          )
          .all() as (ManualPosition & { id: number })[],
      upsert: (position: ManualPosition) => {
        const values = { notes: null, ...position };
        if (position.id) {
          raw
            .prepare(
              `UPDATE manual_positions SET category=@category, name=@name, invested=@invested,
               current_value=@currentValue, currency=@currency, notes=@notes WHERE id=@id`
            )
            .run(values);
          return position.id;
        }
        const result = raw
          .prepare(
            `INSERT INTO manual_positions
             (category, name, invested, current_value, currency, notes)
             VALUES (@category, @name, @invested, @currentValue, @currency, @notes)`
          )
          .run(values);
        return Number(result.lastInsertRowid);
      },
      remove: (id: number) =>
        raw.prepare("DELETE FROM manual_positions WHERE id=?").run(id).changes
    },
    dividends: {
      list: () =>
        raw.prepare("SELECT asset, amount FROM dividends ORDER BY asset").all() as {
          asset: string;
          amount: number;
        }[],
      set: (asset: string, amount: number) =>
        raw
          .prepare(
            `INSERT INTO dividends(asset, amount) VALUES (?, ?)
             ON CONFLICT(asset) DO UPDATE SET amount=excluded.amount`
          )
          .run(asset, amount)
    },
    contributions: {
      list: () =>
        raw
          .prepare("SELECT id, date, amount, notes FROM contributions ORDER BY date")
          .all() as (Contribution & { id: number })[],
      create: (entry: Contribution) =>
        Number(
          raw
            .prepare(
              "INSERT INTO contributions(date, amount, notes) VALUES (@date, @amount, @notes)"
            )
            .run({ notes: null, ...entry }).lastInsertRowid
        ),
      update: (id: number, entry: Contribution) =>
        raw
          .prepare(
            "UPDATE contributions SET date=@date, amount=@amount, notes=@notes WHERE id=@id"
          )
          .run({ notes: null, ...entry, id }).changes,
      remove: (id: number) => raw.prepare("DELETE FROM contributions WHERE id=?").run(id).changes
    },
    prices: {
      list: () =>
        raw
          .prepare(
            `SELECT symbol, currency, price, provider, market_time AS marketTime,
             fetched_at AS fetchedAt, error FROM prices ORDER BY symbol`
          )
          .all() as PriceRecord[],
      get: (symbol: string) =>
        raw
          .prepare(
            `SELECT symbol, currency, price, provider, market_time AS marketTime,
             fetched_at AS fetchedAt, error FROM prices WHERE symbol=?`
          )
          .get(symbol) as PriceRecord | undefined,
      upsert: (price: PriceRecord) =>
        raw
          .prepare(
            `INSERT INTO prices(symbol, currency, price, provider, market_time, fetched_at, error)
             VALUES (@symbol,@currency,@price,@provider,@marketTime,@fetchedAt,@error)
             ON CONFLICT(symbol) DO UPDATE SET currency=excluded.currency, price=excluded.price,
             provider=excluded.provider, market_time=excluded.market_time,
             fetched_at=excluded.fetched_at, error=excluded.error`
          )
          .run(price),
      markError: (symbol: string, error: string, fetchedAt: string) =>
        raw
          .prepare("UPDATE prices SET error=?, fetched_at=? WHERE symbol=?")
          .run(error, fetchedAt, symbol)
    },
    targets: {
      list: () =>
        raw.prepare("SELECT category, weight FROM allocation_targets ORDER BY category").all() as {
          category: string;
          weight: number;
        }[],
      set: (category: string, weight: number) =>
        raw
          .prepare(
            `INSERT INTO allocation_targets(category, weight) VALUES (?,?)
             ON CONFLICT(category) DO UPDATE SET weight=excluded.weight`
          )
          .run(category, weight)
    },
    settings: {
      get: (key: string) =>
        (
          raw.prepare("SELECT value FROM settings WHERE key=?").get(key) as
            | { value: string }
            | undefined
        )?.value,
      set: (key: string, value: string) =>
        raw
          .prepare(
            `INSERT INTO settings(key,value) VALUES (?,?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value`
          )
          .run(key, value)
    },
    snapshots: {
      list: () =>
        (
          raw
            .prepare(
              `SELECT date, total_brl AS totalBrl, payload, price_times AS priceTimes
               FROM snapshots ORDER BY date`
            )
            .all() as {
            date: string;
            totalBrl: number;
            payload: string;
            priceTimes: string;
          }[]
        ).map((row) => ({
          ...row,
          payload: JSON.parse(row.payload),
          priceTimes: JSON.parse(row.priceTimes)
        })),
      upsert: (snapshot: SnapshotInput) =>
        raw
          .prepare(
            `INSERT INTO snapshots(date,total_brl,payload,price_times)
             VALUES (@date,@totalBrl,@payload,@priceTimes)
             ON CONFLICT(date) DO UPDATE SET total_brl=excluded.total_brl,
             payload=excluded.payload, price_times=excluded.price_times`
          )
          .run({
            ...snapshot,
            payload: JSON.stringify(snapshot.payload),
            priceTimes: JSON.stringify(snapshot.priceTimes ?? {})
          })
    },
    imports: {
      has: (fingerprint: string) =>
        Boolean(raw.prepare("SELECT 1 FROM imports WHERE fingerprint=?").get(fingerprint)),
      record: (fingerprint: string, report: unknown) =>
        raw
          .prepare("INSERT INTO imports(fingerprint, imported_at, report) VALUES (?,?,?)")
          .run(fingerprint, new Date().toISOString(), JSON.stringify(report))
    }
  };
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio TEXT NOT NULL CHECK(portfolio IN ('crypto','b3')),
      type TEXT NOT NULL CHECK(type IN ('buy','sell')),
      asset TEXT NOT NULL,
      date TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      total REAL NOT NULL CHECK(total >= 0),
      currency TEXT NOT NULL CHECK(currency IN ('BRL','USD')),
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS crypto_assets (
      symbol TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS manual_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      invested REAL NOT NULL DEFAULT 0,
      current_value REAL NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('BRL','USD')),
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS dividends (
      asset TEXT PRIMARY KEY,
      amount REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS prices (
      symbol TEXT PRIMARY KEY,
      currency TEXT NOT NULL,
      price REAL NOT NULL,
      provider TEXT NOT NULL,
      market_time TEXT,
      fetched_at TEXT NOT NULL,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS allocation_targets (
      category TEXT PRIMARY KEY,
      weight REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      date TEXT PRIMARY KEY,
      total_brl REAL NOT NULL,
      payload TEXT NOT NULL,
      price_times TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS imports (
      fingerprint TEXT PRIMARY KEY,
      imported_at TEXT NOT NULL,
      report TEXT NOT NULL
    );
  `);

  const targetCount = db
    .prepare("SELECT COUNT(*) AS count FROM allocation_targets")
    .get() as { count: number };
  if (targetCount.count === 0) {
    db.exec(`
      INSERT INTO allocation_targets(category, weight) VALUES
        ('bitcoin', 0.25),
        ('shitcoins', 0.05),
        ('dolar', 0.10),
        ('caixa_br', 0.10),
        ('bolsa_brasil', 0.25),
        ('renda_fixa', 0.15),
        ('acoes_globais', 0.10);
    `);
  }
}

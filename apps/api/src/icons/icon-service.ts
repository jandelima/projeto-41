import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type IconKind = "crypto" | "b3" | "institution";

// Nome livre da posição -> domínio para buscar o logo institucional (Clearbit).
const institutionDomains: [string, string][] = [
  ["metamask", "metamask.io"],
  ["binance", "binance.com"],
  ["nubank", "nubank.com.br"],
  ["btg", "btgpactual.com"],
  ["itaú", "itau.com.br"],
  ["itau", "itau.com.br"],
  ["banco do brasil", "bb.com.br"],
  ["tesouro direto bb", "bb.com.br"]
];

function remoteUrl(kind: IconKind, key: string): string | null {
  if (kind === "crypto") {
    return `https://assets.coincap.io/assets/icons/${key.toLowerCase()}@2x.png`;
  }
  if (kind === "b3") {
    return `https://icons.brapi.dev/icons/${key.toUpperCase()}.svg`;
  }
  const lower = key.toLowerCase();
  const hit = institutionDomains.find(([token]) => lower.includes(token));
  return hit ? `https://logo.clearbit.com/${hit[1]}` : null;
}

const extension = (kind: IconKind) => (kind === "b3" ? "svg" : "png");
const contentType = (kind: IconKind) => (kind === "b3" ? "image/svg+xml" : "image/png");
const safeKey = (key: string) =>
  key
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

export function createIconService(iconDir: string, fetcher: typeof fetch = fetch) {
  const filePath = (kind: IconKind, key: string) =>
    join(iconDir, kind, `${safeKey(key)}.${extension(kind)}`);

  async function exists(path: string) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async function ensure(kind: IconKind, key: string) {
    if (!safeKey(key)) return null;
    const path = filePath(kind, key);
    if (await exists(path)) return { path, contentType: contentType(kind) };
    const url = remoteUrl(kind, key);
    if (!url) return null;
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) return null;
      await mkdir(join(iconDir, kind), { recursive: true });
      await writeFile(path, bytes);
      return { path, contentType: contentType(kind) };
    } catch {
      return null;
    }
  }

  async function read(kind: IconKind, key: string) {
    const resolved = await ensure(kind, key);
    if (!resolved) return null;
    return { data: await readFile(resolved.path), contentType: resolved.contentType };
  }

  async function prefetch(items: { kind: IconKind; key: string }[]) {
    let downloaded = 0;
    for (const item of items) {
      const already = await exists(filePath(item.kind, item.key));
      const result = await ensure(item.kind, item.key);
      if (result && !already) downloaded += 1;
    }
    return downloaded;
  }

  return { read, ensure, prefetch, filePath };
}

export type IconService = ReturnType<typeof createIconService>;

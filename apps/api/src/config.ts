import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

export function loadServerConfig(
  root: string,
  processEnvironment: NodeJS.ProcessEnv = process.env
) {
  let fileEnvironment: Record<string, string> = {};

  try {
    fileEnvironment = parse(readFileSync(resolve(root, ".env")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const environment = { ...fileEnvironment, ...processEnvironment };

  return {
    databaseUrl: environment.DATABASE_URL ?? "./data/projeto41.sqlite",
    port: Number(environment.PORT ?? 3001),
    demoMode: environment.DEMO_MODE === "true",
    coingeckoApiKey: environment.COINGECKO_API_KEY ?? "",
    brapiToken: environment.BRAPI_TOKEN ?? "",
    timezone: environment.TZ ?? "America/Fortaleza"
  };
}

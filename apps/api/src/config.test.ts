import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.js";

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("loadServerConfig", () => {
  it("loads the repository root .env when the API starts from a workspace", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "projeto41-config-"));
    writeFileSync(
      join(temporaryDirectory, ".env"),
      [
        "BRAPI_TOKEN=root-token",
        "COINGECKO_API_KEY=demo-key",
        "PORT=4100",
        "TZ=America/Sao_Paulo"
      ].join("\n")
    );

    expect(loadServerConfig(temporaryDirectory, {})).toMatchObject({
      brapiToken: "root-token",
      coingeckoApiKey: "demo-key",
      port: 4100,
      timezone: "America/Sao_Paulo"
    });
  });

  it("keeps process environment variables above values from .env", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "projeto41-config-"));
    writeFileSync(join(temporaryDirectory, ".env"), "BRAPI_TOKEN=file-token\n");

    expect(
      loadServerConfig(temporaryDirectory, { BRAPI_TOKEN: "process-token" }).brapiToken
    ).toBe("process-token");
  });
});

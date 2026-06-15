import { closeSync, mkdirSync, openSync } from "node:fs";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_URL = "http://127.0.0.1:3001";
const HEALTH_URL = `${APP_URL}/api/health`;

export async function launchProject({
  root,
  exists,
  isReady,
  runForeground,
  startDetached,
  waitForReady
}) {
  if (await isReady()) return { started: false };

  if (!exists(resolve(root, "node_modules"))) {
    await runForeground("npm", ["ci"], root);
  }
  if (!exists(resolve(root, "apps/web/dist/index.html"))) {
    await runForeground("npm", ["run", "build"], root);
  }

  await startDetached(root);
  await waitForReady();
  return { started: true };
}

export async function isServerReady(fetcher = fetch) {
  try {
    const response = await fetcher(HEALTH_URL, {
      signal: AbortSignal.timeout(1_000)
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

export async function waitForServer({
  isReady = () => isServerReady(),
  attempts = 60,
  delayMs = 500
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isReady()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
  throw new Error("O servidor não iniciou. Consulte data/projeto41-launcher.log.");
}

function runWithLog(command, args, cwd, logDescriptor, detached = false) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd,
      detached,
      env: process.env,
      stdio: ["ignore", logDescriptor, logDescriptor]
    });
    child.once("error", rejectCommand);
    if (detached) {
      child.unref();
      resolveCommand();
      return;
    }
    child.once("exit", (code) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(`${command} ${args.join(" ")} terminou com código ${code}.`));
    });
  });
}

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const dataDirectory = resolve(root, "data");
  const logPath = resolve(dataDirectory, "projeto41-launcher.log");
  mkdirSync(dataDirectory, { recursive: true });
  const logDescriptor = openSync(logPath, "a");

  try {
    await launchProject({
      root,
      exists: existsSync,
      isReady: () => isServerReady(),
      runForeground: (command, args, cwd) =>
        runWithLog(command, args, cwd, logDescriptor),
      startDetached: (cwd) =>
        runWithLog("npm", ["start"], cwd, logDescriptor, true),
      waitForReady: () => waitForServer()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  } finally {
    closeSync(logDescriptor);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}

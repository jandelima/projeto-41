import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function buildPowerShellArguments({
  distro,
  projectPath,
  scriptPath,
  logoPath
}) {
  return [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Distro",
    distro,
    "-ProjectPath",
    projectPath,
    "-LogoPath",
    logoPath
  ];
}

function windowsPath(path) {
  return execFileSync("wslpath", ["-w", path], { encoding: "utf8" }).trim();
}

function main() {
  const distro = process.env.WSL_DISTRO_NAME;
  if (!distro) {
    throw new Error("Execute este comando dentro do WSL.");
  }

  const root = resolve(import.meta.dirname, "..");
  const scriptPath = windowsPath(resolve(root, "windows/install-shortcut.ps1"));
  const logoPath = windowsPath(resolve(root, "apps/web/public/logo.png"));
  const result = spawnSync(
    "powershell.exe",
    buildPowerShellArguments({
      distro,
      projectPath: root,
      scriptPath,
      logoPath
    }),
    { stdio: "inherit" }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`O instalador do atalho terminou com código ${result.status}.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

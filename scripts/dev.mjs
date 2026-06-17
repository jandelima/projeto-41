import { spawn } from "node:child_process";

const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

const commands = [
  ["api", ["run", "dev", "-w", "@projeto41/api"]],
  ["web", ["run", "dev", "-w", "@projeto41/web"]]
];

const children = commands.map(([name, args]) => {
  const child = spawn(npm, args, {
    detached: !isWin,
    shell: isWin,
    stdio: ["inherit", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  return child;
});

function stop(signal) {
  for (const child of children) {
    if (!child.pid) continue;
    if (isWin) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else process.kill(-child.pid, signal);
  }
}

process.on("SIGINT", () => stop("SIGTERM"));
process.on("SIGTERM", () => stop("SIGTERM"));
await Promise.all(children.map((child) => new Promise((resolve) => child.on("exit", resolve))));

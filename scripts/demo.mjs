import { spawn } from "node:child_process";

const demoEnvironment = {
  ...process.env,
  DATABASE_URL: "./data/projeto41-demo.sqlite",
  PORT: "3101",
  DEMO_MODE: "true"
};

const seed = spawn("npm", ["run", "demo:seed", "-w", "@projeto41/api"], {
  env: demoEnvironment,
  stdio: "inherit"
});
const seedCode = await new Promise((resolve) => seed.on("exit", resolve));
if (seedCode !== 0) process.exit(seedCode ?? 1);

const commands = [
  [
    "api-demo",
    ["run", "start", "-w", "@projeto41/api"],
    demoEnvironment
  ],
  [
    "web-demo",
    ["run", "dev", "-w", "@projeto41/web", "--", "--port", "5174", "--strictPort"],
    {
      ...process.env,
      API_TARGET: "http://127.0.0.1:3101",
      VITE_DEMO_MODE: "true"
    }
  ]
];

const children = commands.map(([name, args, env]) => {
  const child = spawn("npm", args, {
    env,
    detached: true,
    stdio: ["inherit", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  return child;
});

function stop(signal) {
  for (const child of children) {
    if (child.pid) process.kill(-child.pid, signal);
  }
}

process.on("SIGINT", () => stop("SIGTERM"));
process.on("SIGTERM", () => stop("SIGTERM"));
await Promise.all(children.map((child) => new Promise((resolve) => child.on("exit", resolve))));

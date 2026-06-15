import { describe, expect, it, vi } from "vitest";
import { launchProject } from "./launch-project.mjs";

describe("launchProject", () => {
  it("reuses an already running server", async () => {
    const runForeground = vi.fn();
    const startDetached = vi.fn();

    const result = await launchProject({
      root: "/project",
      exists: () => true,
      isReady: vi.fn().mockResolvedValue(true),
      runForeground,
      startDetached,
      waitForReady: vi.fn()
    });

    expect(result).toEqual({ started: false });
    expect(runForeground).not.toHaveBeenCalled();
    expect(startDetached).not.toHaveBeenCalled();
  });

  it("prepares a fresh checkout before starting the server", async () => {
    const existing = new Set();
    const runForeground = vi.fn(async (_command, args) => {
      if (args[0] === "ci") existing.add("/project/node_modules");
      if (args[0] === "run") existing.add("/project/apps/web/dist/index.html");
    });
    const startDetached = vi.fn();
    const waitForReady = vi.fn().mockResolvedValue(undefined);

    const result = await launchProject({
      root: "/project",
      exists: (path) => existing.has(path),
      isReady: vi.fn().mockResolvedValue(false),
      runForeground,
      startDetached,
      waitForReady
    });

    expect(runForeground.mock.calls).toEqual([
      ["npm", ["ci"], "/project"],
      ["npm", ["run", "build"], "/project"]
    ]);
    expect(startDetached).toHaveBeenCalledWith("/project");
    expect(waitForReady).toHaveBeenCalledOnce();
    expect(result).toEqual({ started: true });
  });

  it("does not rebuild an installed project with an existing web build", async () => {
    const runForeground = vi.fn();
    const startDetached = vi.fn();

    await launchProject({
      root: "/project",
      exists: () => true,
      isReady: vi.fn().mockResolvedValue(false),
      runForeground,
      startDetached,
      waitForReady: vi.fn().mockResolvedValue(undefined)
    });

    expect(runForeground).not.toHaveBeenCalled();
    expect(startDetached).toHaveBeenCalledWith("/project");
  });
});

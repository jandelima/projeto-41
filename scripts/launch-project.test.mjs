import { describe, expect, it, vi } from "vitest";
import { buildRuntimeEnvironment, launchProject } from "./launch-project.mjs";

describe("buildRuntimeEnvironment", () => {
  it("puts the active Node installation first in PATH", () => {
    expect(
      buildRuntimeEnvironment(
        "/home/user/.nvm/versions/node/v22.12.0/bin/node",
        { PATH: "/usr/local/bin:/usr/bin" }
      ).PATH
    ).toBe(
      "/home/user/.nvm/versions/node/v22.12.0/bin:/usr/local/bin:/usr/bin"
    );
  });
});

describe("launchProject", () => {
  it("reuses an already running server", async () => {
    const runForeground = vi.fn();
    const runServer = vi.fn();
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const result = await launchProject({
      root: "/project",
      exists: () => true,
      isReady: vi.fn().mockResolvedValue(true),
      runForeground,
      runServer,
      waitForReady: vi.fn(),
      openBrowser
    });

    expect(result).toEqual({ started: false });
    expect(runForeground).not.toHaveBeenCalled();
    expect(runServer).not.toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledOnce();
  });

  it("prepares a fresh checkout before running the server in the foreground", async () => {
    const existing = new Set();
    const runForeground = vi.fn(async (_command, args) => {
      if (args[0] === "ci") existing.add("/project/node_modules");
      if (args[0] === "run") existing.add("/project/apps/web/dist/index.html");
    });
    let stopServer;
    const runServer = vi.fn(
      () => new Promise((resolveServer) => {
        stopServer = resolveServer;
      })
    );
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const launching = launchProject({
      root: "/project",
      exists: (path) => existing.has(path),
      isReady: vi.fn().mockResolvedValue(false),
      runForeground,
      runServer,
      waitForReady: vi.fn().mockResolvedValue(undefined),
      openBrowser
    });

    await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledOnce());
    expect(runForeground.mock.calls).toEqual([
      ["npm", ["ci"], "/project"],
      ["npm", ["run", "build"], "/project"]
    ]);
    expect(runServer).toHaveBeenCalledWith("/project");
    stopServer();
    expect(await launching).toEqual({ started: true });
  });

  it("does not rebuild an installed project with an existing web build", async () => {
    const runForeground = vi.fn();
    let stopServer;
    const runServer = vi.fn(
      () => new Promise((resolveServer) => {
        stopServer = resolveServer;
      })
    );
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const launching = launchProject({
      root: "/project",
      exists: () => true,
      isReady: vi.fn().mockResolvedValue(false),
      runForeground,
      runServer,
      waitForReady: vi.fn().mockResolvedValue(undefined),
      openBrowser
    });

    await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledOnce());
    expect(runForeground).not.toHaveBeenCalled();
    expect(runServer).toHaveBeenCalledWith("/project");
    stopServer();
    await launching;
  });
});

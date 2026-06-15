import { describe, expect, it } from "vitest";
import { buildPowerShellArguments } from "./install-windows-shortcut.mjs";

describe("buildPowerShellArguments", () => {
  it("passes the WSL distro and project paths to the installer", () => {
    expect(
      buildPowerShellArguments({
        distro: "Ubuntu",
        projectPath: "/home/user/projeto-41",
        scriptPath: "\\\\wsl.localhost\\Ubuntu\\home\\user\\projeto-41\\windows\\install-shortcut.ps1",
        logoPath: "\\\\wsl.localhost\\Ubuntu\\home\\user\\projeto-41\\apps\\web\\public\\logo.png"
      })
    ).toEqual([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "\\\\wsl.localhost\\Ubuntu\\home\\user\\projeto-41\\windows\\install-shortcut.ps1",
      "-Distro",
      "Ubuntu",
      "-ProjectPath",
      "/home/user/projeto-41",
      "-LogoPath",
      "\\\\wsl.localhost\\Ubuntu\\home\\user\\projeto-41\\apps\\web\\public\\logo.png"
    ]);
  });
});

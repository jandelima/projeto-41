import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPowerShellArguments } from "./install-windows-shortcut.mjs";

describe("buildPowerShellArguments", () => {
  it("passes the WSL distro and project paths to the installer", () => {
    expect(
      buildPowerShellArguments({
        distro: "Ubuntu",
        projectPath: "/home/user/projeto-41",
        nodePath: "/home/user/.nvm/versions/node/v22.12.0/bin/node",
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
      "-NodePath",
      "/home/user/.nvm/versions/node/v22.12.0/bin/node",
      "-LogoPath",
      "\\\\wsl.localhost\\Ubuntu\\home\\user\\projeto-41\\apps\\web\\public\\logo.png"
    ]);
  });

  it("keeps the WSL process alive while the Node launcher owns the server", () => {
    const installer = readFileSync(
      resolve(import.meta.dirname, "../windows/install-shortcut.ps1"),
      "utf8"
    );

    expect(installer).toContain(
      'command = "wsl.exe -d $vbsDistro --cd $vbsProjectPath $vbsNodePath scripts/launch-project.mjs"'
    );
    expect(installer).toContain("exitCode = shell.Run(command, 0, True)");
    expect(installer).not.toContain('CreateObject("MSXML2.XMLHTTP.6.0")');
  });
});

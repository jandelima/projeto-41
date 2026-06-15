param(
  [Parameter(Mandatory = $true)]
  [string]$Distro,

  [Parameter(Mandatory = $true)]
  [string]$ProjectPath,

  [Parameter(Mandatory = $true)]
  [string]$LogoPath
)

$ErrorActionPreference = "Stop"

$installDirectory = Join-Path $env:LOCALAPPDATA "Projeto41"
$launcherPath = Join-Path $installDirectory "Projeto41.vbs"
$iconPath = Join-Path $installDirectory "Projeto41.ico"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Projeto 41.lnk"

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null

$vbsDistro = $Distro.Replace('"', '""')
$vbsProjectPath = $ProjectPath.Replace('"', '""')
$launcher = @"
Set shell = CreateObject("WScript.Shell")
command = "wsl.exe -d ""$vbsDistro"" --cd ""$vbsProjectPath"" node scripts/launch-project.mjs"
exitCode = shell.Run(command, 0, True)

If exitCode = 0 Then
  shell.Run "http://127.0.0.1:3001", 1, False
Else
  MsgBox "Nao foi possivel iniciar o Projeto 41. Consulte data/projeto41-launcher.log.", 16, "Projeto 41"
End If
"@
Set-Content -Path $launcherPath -Value $launcher -Encoding Unicode

$iconLocation = "$env:SystemRoot\System32\shell32.dll,220"
try {
  Add-Type -AssemblyName System.Drawing
  $source = [System.Drawing.Image]::FromFile($LogoPath)
  $bitmap = New-Object System.Drawing.Bitmap 256, 256
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($source, 0, 0, 256, 256)
  $handle = $bitmap.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($handle)
  $stream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
  $icon.Save($stream)
  $stream.Close()
  $graphics.Dispose()
  $bitmap.Dispose()
  $source.Dispose()
  $iconLocation = "$iconPath,0"
} catch {
  Write-Warning "Nao foi possivel gerar o icone personalizado; sera usado o icone padrao."
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$shortcut.Arguments = "`"$launcherPath`""
$shortcut.WorkingDirectory = $installDirectory
$shortcut.IconLocation = $iconLocation
$shortcut.Description = "Abrir Projeto 41"
$shortcut.Save()

Write-Host "Atalho criado em: $shortcutPath"

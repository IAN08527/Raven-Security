# Build the Raven Intelligence Engine as a Tauri sidecar (--onedir).
# Output binary is renamed to raven-engine-x86_64-pc-windows-msvc.exe
# and placed in src-tauri/binaries so Tauri can spawn it at startup.
$ErrorActionPreference = "Stop"

$target = "x86_64-pc-windows-msvc"
$outDir = "dist\raven-engine"

pyinstaller --noconfirm --onedir --name raven-engine `
  --hidden-import nlp `
  --hidden-import cv `
  --hidden-import analytics `
  --collect-all boxmot `
  --paths . `
  main.py

$dest = "..\src-tauri\binaries\raven-engine-$target.exe"
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Copy-Item "$outDir\raven-engine.exe" $dest
Write-Output "sidecar written to $dest"

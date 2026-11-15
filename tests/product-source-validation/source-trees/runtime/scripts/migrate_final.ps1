$source = Get-Item "."
$target = Join-Path $source.FullName "Silhouette AGI"

Write-Output "Starting surgical sync to: $target"

# Ensure target exists
if (-not (Test-Path $target)) { 
    New-Item -ItemType Directory -Path $target -Force 
}

# 1. Root Files
$files = @('package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'App.tsx', 'index.tsx', 'README.md', 'LICENSE', 'SECURITY.md')
foreach ($f in $files) {
    if (Test-Path $f) {
        Copy-Item $f -Destination $target -Force
        Write-Output "✅ Copied file: $f"
    }
}

# 2. Core Directories
$dirs = @('server', 'services', 'types', 'packages', 'utils', 'voice_engine', 'reasoning_engine', 'universalprompts')
foreach ($d in $dirs) {
    if (Test-Path $d) {
        robocopy $d "$target\$d" /E /R:1 /W:1 /NJH /NJS /NDL /NC /NS /MT:16
        Write-Output "✅ Synced directory: $d"
    }
}

Write-Output "Surgical Sync Complete."

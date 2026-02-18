$currentDir = Get-Item "."
$source = $currentDir.FullName
$targetName = "STAGING_SILHOUETTE_AGI"
$target = Join-Path $source $targetName

Write-Output "Starting surgical extraction..."
Write-Output "Source: $source"
Write-Output "Target: $target"

if (-not (Test-Path $target)) {
    New-Item -ItemType Directory -Path $target -Force
    Write-Output "✅ Created target directory."
}

# 1. Core Directories
$dirs = @('server', 'services', 'types', 'packages', 'utils', 'voice_engine', 'reasoning_engine', 'components', 'hooks', 'public', 'constants', 'docs', 'logo', 'universalprompts', 'config', 'data', 'models', 'cli', 'mocks', 'tests')

foreach ($dir in $dirs) {
    $srcPath = Join-Path $source $dir
    $destPath = Join-Path $target $dir
    if (Test-Path $srcPath) {
        Copy-Item -Path $srcPath -Destination $target -Recurse -Force
        Write-Output "✅ Copied directory: $dir"
    }
}

# 2. Root Files
$files = @('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts', 'vitest.config.ts', 'App.tsx', 'index.tsx', 'index.html', 'index.css', 'tailwind.config.js', 'postcss.config.js', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'INSTALL.md', 'Dockerfile', 'docker-compose.yml', '.gitignore', '.dockerignore', '.gitattributes', '.eslintrc.json', 'silhouette.config.json', 'start_all.bat', 'kill_all.bat', 'setup.bat', 'constants.ts', 'types.ts')

foreach ($file in $files) {
    $srcPath = Join-Path $source $file
    if (Test-Path $srcPath) {
        Copy-Item -Path $srcPath -Destination $target -Force
        Write-Output "✅ Copied file: $file"
    }
}

# 3. Silhouette Internal Core
$silDest = Join-Path $target "silhouette"
if (-not (Test-Path $silDest)) { New-Item -ItemType Directory -Path $silDest -Force }
$silItems = @('src', 'config', 'requirements.txt', 'start_silhouette.bat', 'universalprompts')
foreach ($item in $silItems) {
    $srcPath = Join-Path $source "silhouette\$item"
    if (Test-Path $srcPath) {
        Copy-Item -Path $srcPath -Destination $silDest -Recurse -Force
        Write-Output "✅ Copied silhouette core: $item"
    }
}

# 4. Production Scripts
$scriptsDest = Join-Path $target "scripts"
if (-not (Test-Path $scriptsDest)) { New-Item -ItemType Directory -Path $scriptsDest -Force }
$pScripts = @('install.sh', 'install.ps1', 'bootstrap_v2.ts', 'purge_internal_docs.ts')
foreach ($s in $pScripts) {
    $srcPath = Join-Path $source "scripts\$s"
    if (Test-Path $srcPath) {
        Copy-Item -Path $srcPath -Destination $scriptsDest -Force
        Write-Output "✅ Copied script: $s"
    }
}

Write-Output "Extraction complete."

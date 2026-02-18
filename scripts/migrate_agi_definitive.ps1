$source = Get-Item "."
$targetName = "Silhouette AGI Distribution"
$target = Join-Path $source.FullName $targetName

# 1. Definitive Safe List (Production Core)
$dirs = @(
    'server', 'services', 'types', 'packages', 'utils', 'voice_engine', 'reasoning_engine', 
    'components', 'hooks', 'public', 'constants', 'docs', 'logo', 'universalprompts', 
    'config', 'data', 'models', 'cli', 'mocks', 'tests'
)

$files = @(
    'App.tsx', 'index.tsx', 'index.html', 'index.css', 'constants.ts', 'types.ts',
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json', 
    'vite.config.ts', 'vitest.config.ts', 'tailwind.config.js', 'postcss.config.js',
    'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 
    'SECURITY.md', 'INSTALL.md', 'Dockerfile', 'docker-compose.yml', 
    '.gitignore', '.dockerignore', '.gitattributes', '.eslintrc.json', 
    'silhouette.config.json', 'start_all.bat', 'kill_all.bat', 'setup.bat',
    'fix_animatediff.bat', 'fix_mamba.bat', 'fix_mamba_v2.bat',
    'Modelfile_GLM4_Light', 'Modelfile_Llama_Light', 'Modelfile_Mamba', 'Modelfile_Mamba_Fixed'
)

Write-Host "Starting precision migration to: $target" -ForegroundColor Cyan

if (-not (Test-Path $target)) {
    New-Item -ItemType Directory -Path $target -Force
}

# 2. Migration of Directories
foreach ($dir in $dirs) {
    if (Test-Path "$source\$dir") {
        Copy-Item -Path "$source\$dir" -Destination $target -Recurse -Force
        Write-Host "✅ Copied directory: $dir"
    }
}

# 3. Migration of Root Files
foreach ($file in $files) {
    if (Test-Path "$source\$file") {
        Copy-Item -Path "$source\$file" -Destination $target -Force
        Write-Host "✅ Copied file: $file"
    }
}

# 4. Surgical Silhouette Sub-Items
# (Ensuring we get only logic/prompts, not local DBs or task logs)
$silSrc = Join-Path $source "silhouette"
$silDest = Join-Path $target "silhouette"
if (Test-Path $silSrc) {
    if (-not (Test-Path $silDest)) { New-Item -ItemType Directory -Path $silDest -Force }
    $silSafeItems = @('src', 'config', 'requirements.txt', 'start_silhouette.bat', 'universalprompts')
    foreach ($item in $silSafeItems) {
        $itemPath = Join-Path $silSrc $item
        if (Test-Path $itemPath) {
            Copy-Item -Path $itemPath -Destination $silDest -Recurse -Force
            Write-Host "✅ Copied silhouette core: $item"
        }
    }
}

# 5. Production Scripts
$scriptsSrc = Join-Path $source "scripts"
$scriptsDest = Join-Path $target "scripts"
if (Test-Path $scriptsSrc) {
    if (-not (Test-Path $scriptsDest)) { New-Item -ItemType Directory -Path $scriptsDest -Force }
    # Only keep production-level or useful user scripts
    $pScripts = @('install.sh', 'install.ps1', 'bootstrap_v2.ts', 'purge_internal_docs.ts')
    foreach ($s in $pScripts) {
        $sPath = Join-Path $scriptsSrc $s
        if (Test-Path $sPath) {
            Copy-Item -Path $sPath -Destination $scriptsDest -Force
            Write-Host "✅ Copied script: $s"
        }
    }
}

Write-Host "`nMigration Complete. Distribution ready in $target" -ForegroundColor Green

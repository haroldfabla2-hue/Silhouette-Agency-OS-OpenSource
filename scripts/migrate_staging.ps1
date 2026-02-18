$source = Get-Item "."
$target = Join-Path $source.FullName "STAGING_SILHOUETTE_AGI"

$dirs = @('server', 'services', 'types', 'packages', 'utils', 'voice_engine', 'reasoning_engine', 'components', 'hooks', 'public', 'constants', 'docs', 'logo', 'universalprompts', 'config', 'data', 'models')
$files = @('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts', 'vitest.config.ts', 'App.tsx', 'index.tsx', 'index.html', 'index.css', 'tailwind.config.js', 'postcss.config.js', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'INSTALL.md', 'Dockerfile', 'docker-compose.yml', '.gitignore', '.dockerignore', '.gitattributes', '.eslintrc.json', 'silhouette.config.json', 'start_all.bat', 'kill_all.bat', 'constants.ts', 'types.ts')

echo "Starting Staging Migration to $target..."

if (-not (Test-Path $target)) {
    New-Item -ItemType Directory -Path $target -Force
}

# Copy dirs
foreach ($dir in $dirs) {
    if (Test-Path "$source\$dir") {
        Copy-Item -Path "$source\$dir" -Destination $target -Recurse -Force
        echo "✅ Copied $dir"
    }
}

# Copy files
foreach ($file in $files) {
    if (Test-Path "$source\$file") {
        Copy-Item -Path "$source\$file" -Destination $target -Force
        echo "✅ Copied $file"
    }
}

# Silhouette surgery
$silDest = Join-Path $target "silhouette"
if (-not (Test-Path $silDest)) {
    New-Item -ItemType Directory -Path $silDest -Force
}
$silItems = @('src', 'config', 'requirements.txt', 'start_silhouette.bat', 'universalprompts')
foreach ($item in $silItems) {
    if (Test-Path "$source\silhouette\$item") {
        Copy-Item -Path "$source\silhouette\$item" -Destination $silDest -Recurse -Force
        echo "✅ Copied silhouette\$item"
    }
}

# Scripts surgery
$scriptsDest = Join-Path $target "scripts"
if (-not (Test-Path $scriptsDest)) {
    New-Item -ItemType Directory -Path $scriptsDest -Force
}
$scriptFiles = @('install.sh', 'install.ps1', 'bootstrap_v2.ts')
foreach ($file in $scriptFiles) {
    if (Test-Path "$source\scripts\$file") {
        Copy-Item -Path "$source\scripts\$file" -Destination $scriptsDest -Force
        echo "✅ Copied scripts\$file"
    }
}

echo "Staging Migration Complete."

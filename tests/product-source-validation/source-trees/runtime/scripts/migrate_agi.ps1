$source = "d:\Proyectos personales\Silhouette Agency OS - LLM"
$target = "d:\Proyectos personales\Silhouette AGI"

$dirs = @('server', 'services', 'types', 'packages', 'utils', 'voice_engine', 'reasoning_engine', 'components', 'hooks', 'public', 'constants', 'docs', 'logo', 'universalprompts', 'config', 'data', 'models')
$files = @('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts', 'vitest.config.ts', 'App.tsx', 'index.tsx', 'index.html', 'index.css', 'tailwind.config.js', 'postcss.config.js', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'INSTALL.md', 'Dockerfile', 'docker-compose.yml', '.gitignore', '.dockerignore', '.gitattributes', '.eslintrc.json', 'silhouette.config.json', 'start_all.bat', 'kill_all.bat', 'constants.ts', 'types.ts')

echo "Starting surgical migration..."

if (-not (Test-Path $target)) {
    mkdir -Force $target
}

# Copy dirs
foreach ($dir in $dirs) {
    if (Test-Path "$source\$dir") {
        Copy-Item -Path "$source\$dir" -Destination "$target" -Recurse -Force
        echo "✅ Copied $dir"
    }
}

# Copy files
foreach ($file in $files) {
    if (Test-Path "$source\$file") {
        Copy-Item -Path "$source\$file" -Destination "$target" -Force
        echo "✅ Copied $file"
    }
}

# Silhouette surgery
if (-not (Test-Path "$target\silhouette")) {
    mkdir -Force "$target\silhouette"
}
$silItems = @('src', 'config', 'requirements.txt', 'start_silhouette.bat', 'universalprompts')
foreach ($item in $silItems) {
    if (Test-Path "$source\silhouette\$item") {
        Copy-Item -Path "$source\silhouette\$item" -Destination "$target\silhouette" -Recurse -Force
        echo "✅ Copied silhouette\$item"
    }
}

# Scripts surgery
if (-not (Test-Path "$target\scripts")) {
    mkdir -Force "$target\scripts"
}
$scriptFiles = @('install.sh', 'install.ps1', 'bootstrap_v2.ts')
foreach ($file in $scriptFiles) {
    if (Test-Path "$source\scripts\$file") {
        Copy-Item -Path "$source\scripts\$file" -Destination "$target\scripts" -Force
        echo "✅ Copied scripts\$file"
    }
}

echo "Migration Complete."

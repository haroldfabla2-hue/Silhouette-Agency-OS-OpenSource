# SILHOUETTE AGENCY OS - UNIVERSAL INSTALLER (POWERSHELL)
# =====================================================

$PURPLE = "`e[35m"
$BLUE = "`e[34m"
$GREEN = "`e[32m"
$RED = "`e[31m"
$RESET = "`e[0m"

Write-Host "$PURPLE🌑 SILHOUETTE AGENCY OS - UNIVERSAL INSTALLER$RESET"
Write-Host "$PURPLE==============================================$RESET`n"

# 1. Check Dependencies
Write-Host "$BLUE🔍 Checking dependencies...$RESET"

$deps = @("node", "npm", "git")
foreach ($dep in $deps) {
    if (-not (Get-Command $dep -ErrorAction SilentlyContinue)) {
        Write-Host "$RED❌ $dep is not installed.$RESET"
        exit 1
    }
}

Write-Host "$GREEN✅ All core dependencies found.$RESET"

# 2. Setup
Write-Host "`n$BLUE📦 Installing project dependencies...$RESET"
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "$RED❌ npm install failed.$RESET"
    exit 1
}

Write-Host "$GREEN✅ Dependencies installed successfully.$RESET"

# 3. Launch Bootstrap Wizard
Write-Host "`n$BLUE⚙️  Starting Setup Wizard...$RESET"
npm run setup:v2

if ($LASTEXITCODE -ne 0) {
    Write-Host "$RED❌ Setup Wizard encountered an error.$RESET"
    exit 1
}

Write-Host "`n$PURPLE==============================================$RESET"
Write-Host "$GREEN🎉 INSTALLATION COMPLETE$RESET"
Write-Host "$PURPLE==============================================$RESET"

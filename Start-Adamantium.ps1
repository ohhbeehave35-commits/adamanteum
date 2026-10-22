$ErrorActionPreference = 'Stop'
$adamantiumRoot = $PSScriptRoot
$adamantiumData = if ($env:ADAMANTIUM_DATA_DIR) { [IO.Path]::GetFullPath($env:ADAMANTIUM_DATA_DIR) } else { Join-Path $adamantiumRoot '.data' }
$adamantiumPort = if ($env:PORT) { [int]$env:PORT } else { 4173 }
$adamantiumUrl = "http://127.0.0.1:$adamantiumPort"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or newer, then open Start-Adamantium.ps1 again.' }
$adamantiumNodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($adamantiumNodeMajor -lt 24) { throw 'Adamantium needs Node.js 24 or newer. Your vault has not been changed.' }
$adamantiumDependencies = (Get-Content -LiteralPath (Join-Path $adamantiumRoot 'package.json') -Raw | ConvertFrom-Json).dependencies
$adamantiumInstallNeeded = $false
foreach ($adamantiumDependency in $adamantiumDependencies.PSObject.Properties) {
    $adamantiumInstalled = Join-Path $adamantiumRoot ('node_modules\' + $adamantiumDependency.Name + '\package.json')
    if (-not (Test-Path -LiteralPath $adamantiumInstalled)) { $adamantiumInstallNeeded = $true; break }
    if ((Get-Content -LiteralPath $adamantiumInstalled -Raw | ConvertFrom-Json).version -ne $adamantiumDependency.Value) { $adamantiumInstallNeeded = $true; break }
}
if ($adamantiumInstallNeeded) {
    Push-Location $adamantiumRoot
    try {
        if (Test-Path -LiteralPath (Join-Path $adamantiumRoot 'package-lock.json')) { & npm ci --ignore-scripts }
        else { & npm install --ignore-scripts --no-audit --no-fund }
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your connection and run this launcher again. Your vault is unchanged.' }
    } finally { Pop-Location }
}
$adamantiumConfig = Join-Path $adamantiumData 'local-config.json'
if (-not $env:ADAMANTIUM_VAULT -and -not (Test-Path -LiteralPath $adamantiumConfig)) {
    Add-Type -AssemblyName System.Windows.Forms
    $adamantiumPicker = New-Object System.Windows.Forms.FolderBrowserDialog
    $adamantiumPicker.Description = 'Choose your Obsidian vault or Markdown folder. Adamantium will not change the originals.'
    if ($adamantiumPicker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
    New-Item -ItemType Directory -Path $adamantiumData -Force | Out-Null
    @{ vault = $adamantiumPicker.SelectedPath } | ConvertTo-Json | Set-Content -LiteralPath $adamantiumConfig -Encoding utf8
}
$adamantiumChosenVault = if ($env:ADAMANTIUM_VAULT) { $env:ADAMANTIUM_VAULT } else { (Get-Content -LiteralPath $adamantiumConfig -Raw | ConvertFrom-Json).vault }
if (-not $adamantiumChosenVault) { throw 'The local configuration does not identify a vault folder.' }
if (-not [IO.Path]::IsPathRooted($adamantiumChosenVault)) { $adamantiumChosenVault = Join-Path $adamantiumRoot $adamantiumChosenVault }
$adamantiumChosenVault = [IO.Path]::GetFullPath($adamantiumChosenVault)
if ($adamantiumChosenVault.Length -gt ([IO.Path]::GetPathRoot($adamantiumChosenVault)).Length) { $adamantiumChosenVault = $adamantiumChosenVault.TrimEnd('\') }
$adamantiumChosenVault = $adamantiumChosenVault.ToLowerInvariant()
$adamantiumHash = [Security.Cryptography.SHA256]::Create()
try { $adamantiumVaultId = ([BitConverter]::ToString($adamantiumHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($adamantiumChosenVault)))).Replace('-','').ToLowerInvariant() }
finally { $adamantiumHash.Dispose() }
try {
    $adamantiumHealth = Invoke-RestMethod "$adamantiumUrl/api/status" -TimeoutSec 3
} catch {
    if (Test-Path -LiteralPath (Join-Path $adamantiumData 'index-receipt.json')) { $env:ADAMANTIUM_REUSE_INDEX = '1' }
    Start-Process -FilePath 'node' -ArgumentList '--max-old-space-size=3072','server.mjs' -WorkingDirectory $adamantiumRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $adamantiumRoot 'server.log') -RedirectStandardError (Join-Path $adamantiumRoot 'server-error.log')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 500
        try { $adamantiumHealth = Invoke-RestMethod "$adamantiumUrl/api/status" -TimeoutSec 2; break } catch {}
    }
}
if (-not $adamantiumHealth) { throw 'Adamantium did not start. Check server-error.log.' }
if ($adamantiumHealth.schema -ne 'adamantium.status/v1') { throw "Another application or older Adamantium build is using port $adamantiumPort. Close that process before starting this build." }
if ($adamantiumHealth.vaultId -ne $adamantiumVaultId) { throw 'The running Adamantium instance belongs to a different vault. Close that instance first. This launcher will not open another vault instead of yours.' }
Start-Process $adamantiumUrl

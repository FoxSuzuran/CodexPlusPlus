$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This build entry is for Windows.' }
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'target'
$evidence = Join-Path $target 'temp\windows-build'
$sweep = Join-Path $target 'tools\cargo-sweep\bin\cargo-sweep.exe'
if (-not (Test-Path -LiteralPath $sweep)) {
    throw 'Install cargo-sweep 0.8.0 with: cargo install cargo-sweep --version 0.8.0 --locked --root target/tools/cargo-sweep --target-dir target --jobs 4'
}
$overrides = @(Get-ChildItem Env: | Where-Object {
    $_.Name -match '^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_INCREMENTAL|CARGO_PROFILE_.*|CARGO_TARGET_DIR|CARGO_BUILD_TARGET_DIR|CARGO_BUILD_BUILD_DIR|CARGO_BUILD_RUSTFLAGS|CARGO_BUILD_JOBS)$'
})
$saved = @{}
foreach ($name in @('TEMP', 'TMP') + @($overrides | ForEach-Object { $_.Name })) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$locks = @()
Push-Location $root
try {
    if ($overrides.Count) {
        Write-Host "Clearing build subprocess overrides: $($overrides.Name -join ', ')"
        foreach ($entry in $overrides) { [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process') }
    }
    $env:TEMP = Join-Path $target 'temp'
    $env:TMP = $env:TEMP
    New-Item -ItemType Directory -Path $evidence -Force | Out-Null
    & $sweep sweep --stamp $root
    if ($LASTEXITCODE -ne 0) { throw 'Could not stamp the build cache.' }

    Write-Host 'Compiling the current dev/test graph for cache retention...'
    & cargo test --workspace --all-targets --no-run --locked --offline --message-format=json 2> (Join-Path $evidence 'dev.stderr.log') |
        Set-Content -LiteralPath (Join-Path $evidence 'dev.jsonl') -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "Dev/test compilation failed; see $evidence" }

    Write-Host 'Building the complete production frontend...'
    & npm.cmd --prefix apps/codex-plus-manager run vite:build *> (Join-Path $evidence 'frontend.log')
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed; see $evidence" }
    Write-Host 'Building the fixed Windows release...'
    & cargo xrelease --timings --message-format=json 2> (Join-Path $evidence 'release.stderr.log') |
        Set-Content -LiteralPath (Join-Path $evidence 'release.jsonl') -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "Windows release failed; see $evidence" }

    foreach ($profile in @('debug', 'release')) {
        $file = [IO.File]::Open((Join-Path $target "$profile\.cargo-lock"), 'OpenOrCreate', 'ReadWrite', 'ReadWrite')
        try { $file.Lock(0, 1) } catch { $file.Dispose(); throw }
        $locks += $file
    }
    $pinsJson = & node scripts/cargo-build-pins.mjs (Join-Path $evidence 'dev.jsonl') (Join-Path $evidence 'release.jsonl')
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify the live build artifacts; cache was retained.' }
    $pinsJson | Set-Content -LiteralPath (Join-Path $evidence 'pins.json') -Encoding utf8
    $pins = $pinsJson | ConvertFrom-Json
    $accessed = [DateTime]::UtcNow
    foreach ($file in $pins.fingerprintFiles) { [IO.File]::SetLastAccessTimeUtc($file, $accessed) }
    Write-Host "Keeping $($pins.artifactFiles.Count) current artifacts; pruning older Cargo fingerprints..."
    & $sweep sweep --file --dry-run --verbose $root *> (Join-Path $evidence 'prune-preview.log')
    if ($LASTEXITCODE -ne 0) { throw 'Cargo cache preview failed; cache was retained.' }
    & $sweep sweep --file --verbose $root *> (Join-Path $evidence 'prune.log')
    if ($LASTEXITCODE -ne 0) { throw "Cargo cache cleanup failed; see $evidence" }
    foreach ($file in $pins.artifactFiles) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Current artifact was removed: $file" }
    }
    Write-Host "Built: $(Join-Path $target 'release\codex-plus-plus.exe')"
    Write-Host "Build and cache records: $evidence"
} finally {
    foreach ($file in $locks) { $file.Unlock(0, 1); $file.Dispose() }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    Pop-Location
}

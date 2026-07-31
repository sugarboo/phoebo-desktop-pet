[CmdletBinding()]
param(
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") |
    ConvertFrom-Json
$releaseExecutable = Join-Path $projectRoot "src-tauri\target\release\phoebo-desktop-pet.exe"

if (-not $SkipBuild) {
    Push-Location $projectRoot
    try {
        # --no-bundle produces the size-oriented executable without generating an
        # installer. tauri.windows.conf.json also prevents WebView2 bundling.
        & npm run tauri build -- --no-bundle
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri release build failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $releaseExecutable -PathType Leaf)) {
    throw "Release executable was not found at $releaseExecutable"
}

# Packaging should never bypass the reviewed capability, asset, size, WebView2,
# and no-background-network policy checks.
& (Join-Path $PSScriptRoot "verify-release.ps1") `
    -ExecutablePath $releaseExecutable |
    Out-Null

# The frontend contract is one embedded WebP and no generated PNG frame files.
$webpAssets = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot "dist\assets") -Filter "*.webp")
$pngAssets = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot "dist\assets") -Filter "*.png")
if ($webpAssets.Count -ne 1 -or $pngAssets.Count -ne 0) {
    throw "Expected exactly one WebP atlas and no PNG assets in dist"
}

$hash = (Get-FileHash -LiteralPath $releaseExecutable -Algorithm SHA256).Hash
$hashPrefix = $hash.Substring(0, 12).ToLowerInvariant()
$artifactRoot = Join-Path $projectRoot "artifacts"
$releaseName = "Phoebo-$($package.version)-windows-x64-$hashPrefix"
$portableDirectory = Join-Path $artifactRoot $releaseName
$portableExecutable = Join-Path $portableDirectory "Phoebo.exe"
$portableReadme = Join-Path $portableDirectory "README.md"
$checksumFile = Join-Path $portableDirectory "SHA256SUMS.txt"
$zipPath = Join-Path $artifactRoot "$releaseName.zip"

# A content-addressed directory can already exist after a repeated release run.
# Recreate only that exact generated child so stale files cannot leak into the ZIP.
$resolvedArtifactRoot = [System.IO.Path]::GetFullPath($artifactRoot)
$resolvedPortableDirectory = [System.IO.Path]::GetFullPath($portableDirectory)
$artifactPrefix = $resolvedArtifactRoot.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedPortableDirectory.StartsWith(
    $artifactPrefix,
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    throw "Refusing to recreate a portable directory outside artifacts"
}
if (Test-Path -LiteralPath $resolvedPortableDirectory) {
    Remove-Item -LiteralPath $resolvedPortableDirectory -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $portableDirectory | Out-Null
Copy-Item -LiteralPath $releaseExecutable -Destination $portableExecutable -Force
Copy-Item `
    -LiteralPath (Join-Path $projectRoot "docs\windows-portable-release.md") `
    -Destination $portableReadme `
    -Force

# Keep the checksum filename relative so common SHA-256 tools can verify the
# extracted portable folder without knowing the builder's absolute path.
"$hash *Phoebo.exe" | Set-Content -LiteralPath $checksumFile -Encoding ascii
$actualPortableFiles = @(
    Get-ChildItem -LiteralPath $portableDirectory -File |
        Select-Object -ExpandProperty Name |
        Sort-Object
)
$expectedPortableFiles = @(
    "Phoebo.exe",
    "README.md",
    "SHA256SUMS.txt"
) | Sort-Object
if (
    $actualPortableFiles.Count -ne $expectedPortableFiles.Count -or
    @(Compare-Object $actualPortableFiles $expectedPortableFiles).Count -ne 0
) {
    throw "Portable directory differs from the reviewed three-file layout"
}
Compress-Archive `
    -Path (Join-Path $portableDirectory "*") `
    -DestinationPath $zipPath `
    -CompressionLevel Optimal `
    -Force

[PSCustomObject]@{
    Version = [string]$package.version
    Platform = "windows-x64"
    ExecutableBytes = (Get-Item -LiteralPath $portableExecutable).Length
    Sha256 = $hash
    PortableDirectory = $portableDirectory
    Zip = $zipPath
}

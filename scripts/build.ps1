# Chrome Extension Build Script (PowerShell)
# Usage: .\scripts\build.ps1

param(
    [switch]$Clean = $false
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtensionDir = Split-Path -Parent $ScriptDir

Write-Host "🔧 Building Chrome Extension..." -ForegroundColor Cyan

# Change to extension directory
Push-Location $ExtensionDir

try {
    # Read version from manifest
    $manifest = Get-Content "manifest.json" | ConvertFrom-Json
    $version = $manifest.version
    Write-Host "📋 Version: $version" -ForegroundColor Green

    # Output filename
    $zipName = "myvideoresume-chrome-extension-$version.zip"

    # Clean old builds if requested
    if ($Clean) {
        Write-Host "🧹 Cleaning old builds..." -ForegroundColor Yellow
        Remove-Item -Path "*.zip" -ErrorAction SilentlyContinue
    }

    # Remove old specific build if exists
    if (Test-Path $zipName) {
        Remove-Item $zipName
    }

    # Files to include in the build
    $filesToInclude = @(
        "manifest.json",
        "*.js",
        "*.html",
        "*.css",
        "icons",
        "imgs",
        "libs"
    )

    # Create a temp directory for packaging
    $tempDir = Join-Path $env:TEMP "chrome-ext-build-$(Get-Random)"
    New-Item -ItemType Directory -Path $tempDir | Out-Null

    # Copy files to temp directory
    foreach ($pattern in $filesToInclude) {
        $items = Get-Item $pattern -ErrorAction SilentlyContinue
        foreach ($item in $items) {
            if ($item.PSIsContainer) {
                Copy-Item $item.FullName -Destination $tempDir -Recurse
            } else {
                Copy-Item $item.FullName -Destination $tempDir
            }
        }
    }

    # Create zip
    Write-Host "📦 Creating $zipName..." -ForegroundColor Cyan
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipName -Force

    # Cleanup temp
    Remove-Item -Path $tempDir -Recurse -Force

    # Show result
    $zipInfo = Get-Item $zipName
    Write-Host ""
    Write-Host "✅ Build complete!" -ForegroundColor Green
    Write-Host "   File: $zipName" -ForegroundColor White
    Write-Host "   Size: $([math]::Round($zipInfo.Length / 1KB, 2)) KB" -ForegroundColor White
    Write-Host ""
    Write-Host "📤 Upload to Chrome Web Store:" -ForegroundColor Yellow
    Write-Host "   https://chrome.google.com/webstore/devconsole" -ForegroundColor Blue

} finally {
    Pop-Location
}


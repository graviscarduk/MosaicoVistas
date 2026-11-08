<#
.SYNOPSIS
    Monta o pacote portátil "Mosaico Vistas" em dist/.

.DESCRIPTION
    Copia o app, os scripts .vbs e o runtime (node.exe) para uma pasta
    "Mosaico Vistas" e gera o ZIP pronto para distribuição.

.EXAMPLE
    ./build.ps1
    Usa o node.exe da raiz do projeto.

.EXAMPLE
    ./build.ps1 -NodeExe "D:\node\node.exe"
    Usa um node.exe específico.

.EXAMPLE
    ./build.ps1 -Version v1.0.0
    Força a versão usada no nome do ZIP.
#>
param(
    [string]$NodeExe = "node.exe",
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if (-not [System.IO.Path]::IsPathRooted($NodeExe)) {
    $NodeExe = Join-Path $root $NodeExe
}

if (-not (Test-Path $NodeExe)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) {
        $NodeExe = $cmd.Source
        Write-Host "node.exe nao encontrado no projeto; usando o Node.js do PATH: $NodeExe"
    }
    else {
        throw "node.exe nao encontrado. Baixe em https://nodejs.org/dist/ ou use -NodeExe <caminho>."
    }
}

if (-not $Version) {
    $pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
    $Version = $pkg.version
}
$Version = $Version -replace '^v', ''

$name = "Mosaico Vistas"
$outDir = Join-Path $root "dist"
$stage = Join-Path $outDir $name

if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Copy-Item $NodeExe (Join-Path $stage "node.exe")
Copy-Item (Join-Path $root "app") $stage -Recurse

$files = @("Mosaico Vistas.vbs", "Parar Mosaico.vbs", "LEIA-ME.txt", "README.md")
foreach ($f in $files) {
    Copy-Item (Join-Path $root $f) $stage
}

$zip = Join-Path $outDir "Mosaico-Vistas-v$Version.zip"
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal

Write-Host ""
Write-Host "Pacote gerado: $zip"
Write-Host ("Tamanho: {0:N1} MB" -f ((Get-Item $zip).Length / 1MB))

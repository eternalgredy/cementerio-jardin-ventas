param(
  [string]$DxfPath = ".\plano.dxf",
  [string]$SvgPath = ".\plano.svg"
)

$ErrorActionPreference = "Stop"

$inkscape = "C:\Program Files\Inkscape\bin\inkscape.exe"
if (-not (Test-Path -LiteralPath $inkscape)) {
  throw "No encontre Inkscape en $inkscape"
}

if (-not (Test-Path -LiteralPath $DxfPath)) {
  throw "No encontre el DXF: $DxfPath. Primero exporta el DWG como DXF."
}

& $inkscape $DxfPath --export-type=svg --export-filename=$SvgPath

if (-not (Test-Path -LiteralPath $SvgPath)) {
  throw "Inkscape termino, pero no se genero $SvgPath"
}

Write-Host "SVG generado: $SvgPath"

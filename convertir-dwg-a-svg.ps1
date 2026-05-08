param(
  [string]$DwgPath = ".\PLANO JARDIN TOP ACT 23-04-26.dwg",
  [string]$SvgPath = ".\plano.svg",
  [switch]$Completo
)

$ErrorActionPreference = "Stop"

$oda = "C:\Program Files\ODA\ODAFileConverter 27.1.0\ODAFileConverter.exe"
if (-not (Test-Path -LiteralPath $oda)) {
  throw "No encontre ODA File Converter en $oda"
}

if (-not (Test-Path -LiteralPath $DwgPath)) {
  throw "No encontre el DWG: $DwgPath"
}

$dxfDir = ".\convertido-dxf"
New-Item -ItemType Directory -Force -Path $dxfDir | Out-Null

$dxfPath = Join-Path $dxfDir "plano.dxf"

$script = @"
from pathlib import Path
import ezdxf
from ezdxf.addons import odafc
from ezdxf import recover
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.svg import SVGBackend
from ezdxf.addons.drawing.layout import Page, Settings, Units

oda = r"$oda"
dwg = Path(r"$DwgPath")
dxf = Path(r"$dxfPath")
svg = Path(r"$SvgPath")

ezdxf.options.set("odafc-addon", "win_exec_path", oda)
odafc.convert(dwg, dxf, version="R2018", audit=True, replace=True)

print(f"DXF generado: {dxf}")
"@

$script | python -

if ($Completo) {
  $render = @"
from pathlib import Path
from ezdxf import recover
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.svg import SVGBackend
from ezdxf.addons.drawing.layout import Page, Settings, Units

dxf = Path(r"$dxfPath")
svg = Path(r"$SvgPath")
doc, auditor = recover.readfile(dxf)
ctx = RenderContext(doc)
backend = SVGBackend()
Frontend(ctx, backend).draw_layout(doc.modelspace())
page = Page(0, 0, Units.mm, max_width=5000, max_height=5000)
settings = Settings(fit_page=True, output_layers=True, fixed_stroke_width=0.2)
svg.write_text(backend.get_string(page, settings=settings), encoding="utf-8")
print(f"SVG completo generado: {svg} ({svg.stat().st_size} bytes)")
"@
  $render | python -
} else {
  powershell -ExecutionPolicy Bypass -File .\generar-svg-filtrado.ps1 $dxfPath $SvgPath
}

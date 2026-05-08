param(
  [string]$DxfPath = ".\convertido-dxf\plano.dxf",
  [string]$SvgPath = ".\plano.svg"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DxfPath)) {
  throw "No encontre el DXF: $DxfPath. Ejecuta primero .\convertir-dwg-a-svg.ps1"
}

$script = @"
from pathlib import Path
from ezdxf import recover
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.svg import SVGBackend
from ezdxf.addons.drawing.layout import Page, Settings, Units
from ezdxf.addons.drawing.config import Configuration, ColorPolicy, BackgroundPolicy

dxf = Path(r"$DxfPath")
svg = Path(r"$SvgPath")

visible_layers = {
    "PERIMETRO",
    "PERIMETRO INTERMEDIO",
    "PREDIO",
    "NICHOS",
    "DIVISONES 2",
    "DIVISIONES ADICIONALES",
    "NUMERO LOTE",
    "NUMERO DE LOTE ADICIONAL",
}

visible_types = {
    "LINE",
    "LWPOLYLINE",
    "POLYLINE",
    "ARC",
    "CIRCLE",
    "ELLIPSE",
    "SPLINE",
    "TEXT",
    "MTEXT",
    "INSERT",
}

doc, auditor = recover.readfile(dxf)
if auditor.has_errors:
    print(f"DXF con advertencias/errores: {len(auditor.errors)}")

ctx = RenderContext(doc)
backend = SVGBackend()
config = Configuration(
    color_policy=ColorPolicy.BLACK,
    background_policy=BackgroundPolicy.WHITE,
)

def only_needed_layers(entity):
    return entity.dxf.layer in visible_layers and entity.dxftype() in visible_types

Frontend(ctx, backend, config=config).draw_layout(
    doc.modelspace(),
    filter_func=only_needed_layers,
)

page = Page(0, 0, Units.mm, max_width=5000, max_height=5000)
settings = Settings(fit_page=True, output_layers=True, fixed_stroke_width=0.18)
svg.write_text(backend.get_string(page, settings=settings), encoding="utf-8")

print(f"SVG filtrado generado: {svg} ({svg.stat().st_size} bytes)")
"@

$script | python -

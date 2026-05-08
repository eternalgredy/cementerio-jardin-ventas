param(
  [string]$DxfPath = ".\convertido-dxf\plano.dxf",
  [double]$MaxDistance = 2.5
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DxfPath)) {
  throw "No encontre el DXF: $DxfPath"
}

$script = @"
import ezdxf, re, math, json, heapq
from pathlib import Path

doc = ezdxf.readfile(r"$DxfPath")
msp = doc.modelspace()
code_layer = "NUMERO LOTE"
box_layers = {"DIVISONES 2", "DIVISIONES ADICIONALES"}
code_pattern = re.compile(r"^([A-Z]{1,3})(\d{1,3})$")

def pts_of(e):
    if e.dxftype() == "LWPOLYLINE":
        return [(float(x), float(y)) for x, y, *_ in e.get_points()]
    if e.dxftype() == "POLYLINE":
        return [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in e.vertices]
    if e.dxftype() == "LINE":
        return [(float(e.dxf.start.x), float(e.dxf.start.y)), (float(e.dxf.end.x), float(e.dxf.end.y))]
    return []

def poly_area(poly):
    return abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2)

def centroid(poly):
    return (sum(x for x, y in poly) / len(poly), sum(y for x, y in poly) / len(poly))

def clean_poly(pts):
    if len(pts) > 2 and math.dist(pts[0], pts[-1]) < 1e-6:
        return pts[:-1]
    return pts

def is_convex_quad(pts):
    if len(pts) != 4:
        return False
    sides = [math.dist(pts[i], pts[(i + 1) % 4]) for i in range(4)]
    if min(sides) <= 0 or max(sides) / min(sides) > 5:
        return False
    signs = []
    for i in range(4):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % 4]
        cx, cy = pts[(i + 2) % 4]
        cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
        if abs(cross) < 1e-6:
            return False
        signs.append(cross > 0)
    return all(sign == signs[0] for sign in signs)

def is_cell_polygon(pts):
    return is_convex_quad(pts) and 0.2 < poly_area(pts) < 20

def clean_text(value):
    return re.sub(r"\\[A-Za-z][^;]*;|[{}]", "", str(value)).strip().upper()

def add_label(labels, seen, code, point):
    match = code_pattern.match(code)
    if not match or code in seen:
        return
    seen.add(code)
    labels.append({
        "id": code,
        "grupo": match.group(1),
        "numero": int(match.group(2)),
        "point": point,
    })

def mtext_direction(entity):
    direction = entity.dxf.get("text_direction", None)
    if direction is not None:
        x, y = float(direction.x), float(direction.y)
        length = math.hypot(x, y) or 1
        return (x / length, y / length)
    rotation = math.radians(float(entity.dxf.get("rotation", 0)))
    return (math.cos(rotation), math.sin(rotation))

candidates = []
for e in msp:
    if e.dxf.layer == "DIVISIONES ADICIONALES" and e.dxftype() == "INSERT":
        try:
            for ve in e.virtual_entities():
                if ve.dxftype() in ("LWPOLYLINE", "POLYLINE"):
                    pts = clean_poly(pts_of(ve))
                    if is_cell_polygon(pts):
                        candidates.append({"pts": pts, "center": centroid(pts), "area": poly_area(pts)})
        except Exception:
            pass

for e in msp:
    if e.dxf.layer == "DIVISONES 2" and e.dxftype() in ("LWPOLYLINE", "POLYLINE"):
        pts = clean_poly(pts_of(e))
        if is_cell_polygon(pts):
            candidates.append({"pts": pts, "center": centroid(pts), "area": poly_area(pts)})

labels = []
seen = set()
for e in msp:
    if e.dxf.layer != code_layer or e.dxftype() not in ("TEXT", "MTEXT"):
        continue
    ins = e.dxf.get("insert", None)
    if not ins:
        continue
    if e.dxftype() == "TEXT":
        add_label(labels, seen, clean_text(e.dxf.text), (float(ins.x), float(ins.y)))
        continue

    direction_x, direction_y = mtext_direction(e)
    line_x, line_y = direction_y, -direction_x
    char_height = float(e.dxf.get("char_height", 0.6) or 0.6)
    line_spacing = float(e.dxf.get("line_spacing_factor", 1.0) or 1.0)
    line_step = char_height * 5 / 3 * line_spacing
    for line_index, raw_line in enumerate(e.plain_text().splitlines()):
        code = clean_text(raw_line)
        point = (
            float(ins.x) + line_x * line_step * line_index,
            float(ins.y) + line_y * line_step * line_index,
        )
        add_label(labels, seen, code, point)

labels.sort(key=lambda x: (x["grupo"], x["numero"], x["id"]))
assigned = []
adjacency = []
edge_distances = {}
for label_index, label in enumerate(labels):
    edges = []
    for poly_index, poly in enumerate(candidates):
        d = math.dist(label["point"], poly["center"])
        if d <= ${MaxDistance}:
            edges.append((poly_index, d))
            edge_distances[(label_index, poly_index)] = d
    edges.sort(key=lambda item: item[1])
    adjacency.append([poly_index for poly_index, distance in edges])

source = 0
label_offset = 1
poly_offset = label_offset + len(labels)
sink = poly_offset + len(candidates)
node_count = sink + 1
graph = [[] for _ in range(node_count)]

def add_edge(start, end, capacity, cost):
    forward = [end, capacity, cost, len(graph[end])]
    backward = [start, 0, -cost, len(graph[start])]
    graph[start].append(forward)
    graph[end].append(backward)

for label_index in range(len(labels)):
    add_edge(source, label_offset + label_index, 1, 0)
    for poly_index in adjacency[label_index]:
        distance_cost = int(round(edge_distances[(label_index, poly_index)] * 1000000))
        add_edge(label_offset + label_index, poly_offset + poly_index, 1, distance_cost)

for poly_index in range(len(candidates)):
    add_edge(poly_offset + poly_index, sink, 1, 0)

pair_label = [-1] * len(labels)
potential = [0] * node_count
infinity = 10 ** 18
flow = 0
target_flow = len(labels)

while flow < target_flow:
    distances = [infinity] * node_count
    previous = [None] * node_count
    distances[source] = 0
    heap = [(0, source)]
    while heap:
        current_distance, node = heapq.heappop(heap)
        if current_distance != distances[node]:
            continue
        for edge_index, edge in enumerate(graph[node]):
            next_node, capacity, cost, reverse_index = edge
            if capacity <= 0:
                continue
            reduced_cost = cost + potential[node] - potential[next_node]
            next_distance = current_distance + reduced_cost
            if next_distance < distances[next_node]:
                distances[next_node] = next_distance
                previous[next_node] = (node, edge_index)
                heapq.heappush(heap, (next_distance, next_node))
    if distances[sink] == infinity:
        break
    for node in range(node_count):
        if distances[node] < infinity:
            potential[node] += distances[node]
    node = sink
    while node != source:
        previous_node, edge_index = previous[node]
        edge = graph[previous_node][edge_index]
        edge[1] -= 1
        graph[node][edge[3]][1] += 1
        node = previous_node
    flow += 1

for label_index in range(len(labels)):
    label_node = label_offset + label_index
    for edge in graph[label_node]:
        poly_node, capacity, cost, reverse_index = edge
        if poly_offset <= poly_node < sink and capacity == 0 and graph[poly_node][reverse_index][1] == 1:
            pair_label[label_index] = poly_node - poly_offset
            break

for label_index, poly_index in enumerate(pair_label):
    if poly_index == -1:
        continue
    label = labels[label_index]
    poly = candidates[poly_index]
    d = edge_distances[(label_index, poly_index)]
    assigned.append({
        "id": label["id"],
        "grupo": label["grupo"],
        "numero": label["numero"],
        "raw_text": label["point"],
        "raw_points": poly["pts"],
        "raw_label": poly["center"],
        "distance": round(d, 3),
        "inferred": False,
    })

assigned.sort(key=lambda x: (x["grupo"], x["numero"], x["id"]))
label_points = {label["id"]: label["point"] for label in labels}
repair_threshold = 1.3
for group in sorted({lot["grupo"] for lot in assigned}):
    group_lots = [lot for lot in assigned if lot["grupo"] == group]
    good_lots = [lot for lot in group_lots if lot["distance"] <= repair_threshold]
    if not good_lots:
        continue
    for lot in group_lots:
        if lot["distance"] <= repair_threshold:
            continue
        source = min(good_lots, key=lambda item: abs(item["numero"] - lot["numero"]))
        source_text = label_points[source["id"]]
        target_text = label_points[lot["id"]]
        delta_x = target_text[0] - source_text[0]
        delta_y = target_text[1] - source_text[1]
        lot["raw_points"] = [(x + delta_x, y + delta_y) for x, y in source["raw_points"]]
        lot["raw_label"] = (source["raw_label"][0] + delta_x, source["raw_label"][1] + delta_y)
        lot["distance"] = round(math.dist(target_text, lot["raw_label"]), 3)
        lot["inferred"] = True
        lot["source"] = source["id"]

for group in sorted({lot["grupo"] for lot in assigned}):
    group_lots = sorted([lot for lot in assigned if lot["grupo"] == group], key=lambda item: item["numero"])
    if len(group_lots) < 4:
        continue
    gaps = [
        math.dist(group_lots[index]["raw_label"], group_lots[index + 1]["raw_label"])
        for index in range(len(group_lots) - 1)
        if group_lots[index + 1]["numero"] == group_lots[index]["numero"] + 1
    ]
    if not gaps:
        continue
    median_gap = sorted(gaps)[len(gaps) // 2]
    repair_start = None
    for index in range(len(group_lots) - 1):
        current = group_lots[index]
        next_lot = group_lots[index + 1]
        if next_lot["numero"] != current["numero"] + 1:
            continue
        gap = math.dist(current["raw_label"], next_lot["raw_label"])
        if gap > median_gap * 1.45:
            repair_start = index + 1
            break
    if repair_start is None or repair_start == 0:
        continue
    source = group_lots[repair_start - 1]
    source_text = label_points[source["id"]]
    for lot in group_lots[repair_start:]:
        target_text = label_points[lot["id"]]
        delta_x = target_text[0] - source_text[0]
        delta_y = target_text[1] - source_text[1]
        lot["raw_points"] = [(x + delta_x, y + delta_y) for x, y in source["raw_points"]]
        lot["raw_label"] = (source["raw_label"][0] + delta_x, source["raw_label"][1] + delta_y)
        lot["distance"] = round(math.dist(target_text, lot["raw_label"]), 3)
        lot["inferred"] = True
        lot["source"] = source["id"]
        lot["repair"] = "sequence"

if assigned:
    extent_points = [pt for lot in assigned for pt in lot["raw_points"]]
else:
    extent_points = [poly["center"] for poly in candidates] + [label["point"] for label in labels]

minx = min(x for x, y in extent_points)
maxx = max(x for x, y in extent_points)
miny = min(y for x, y in extent_points)
maxy = max(y for x, y in extent_points)
raw_width = max(maxx - minx, 1)
raw_height = max(maxy - miny, 1)
padding = max(raw_width, raw_height) * 0.035
minx -= padding
maxx += padding
miny -= padding
maxy += padding
width = max(maxx - minx, 1)
height = max(maxy - miny, 1)
canvas_w = 1000
canvas_h = round(canvas_w * height / width, 3)

def norm(p):
    x, y = p
    return (round((x - minx) / width * canvas_w, 3), round((maxy - y) / height * canvas_h, 3))

lots = [
    {
        "id": lot["id"],
        "grupo": lot["grupo"],
        "numero": lot["numero"],
        "points": [norm(pt) for pt in lot["raw_points"]],
        "label": norm(lot["raw_label"]),
        "distance": lot["distance"],
        "inferred": lot.get("inferred", False),
        "source": lot.get("source", ""),
        "repair": lot.get("repair", ""),
    }
    for lot in assigned
]

Path("plano-vector.js").write_text("window.PLANO_VECTOR = " + json.dumps({
    "width": canvas_w,
    "height": canvas_h,
    "cells": [
        {
            "points": [norm(pt) for pt in lot["raw_points"]],
        }
        for lot in assigned
    ],
    "detectedCells": [
        {
            "points": [norm(pt) for pt in poly["pts"]],
        }
        for poly in candidates
    ],
    "lots": lots,
    "base": [],
    "labels": [
        {
            "id": label["id"],
            "grupo": label["grupo"],
            "numero": label["numero"],
            "label": norm(label["point"]),
        }
        for label in labels
    ],
}, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")

Path("lotes-data.js").write_text("window.LOTES_DATA = " + json.dumps([
    {
        "id": label["id"],
        "grupo": label["grupo"],
        "numero": label["numero"],
        "x": round(norm(label["point"])[0] / canvas_w * 100, 4),
        "y": round(norm(label["point"])[1] / canvas_h * 100, 4),
    }
    for label in labels
], ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")

print(f"Vector generado: {len(assigned)} cuadros pintables de {len(labels)} codigos reales")
"@

$script | python -

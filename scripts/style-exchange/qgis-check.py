"""Opens the style-exchange fixture export in QGIS and checks what QGIS makes of it.

Run after `npx tsx scripts/style-exchange/write-fixture-export.ts <dir>`, inside a QGIS container:

    docker run --rm --platform linux/amd64 -e QT_QPA_PLATFORM=offscreen -v <dir>:/w \
        qgis/qgis:latest python3 /w/qgis-check.py /w

(copy this script into <dir> first, or mount it separately). For each layer it opens
`data/<id>.shp`, checks the `.qml` beside it loaded by itself and through `loadNamedStyle`, compares
the renderer, its rules and their symbol layer classes with `manifest.json`, checks that every
feature is drawn by exactly the rule PGMaps draws it with, and renders the layer to PNG. It then
opens the `.qgz` (layers valid, layout present, exported to PNG), loads the `.qpt`, imports the
style library, and saves QGIS's own copies of the files into `<dir>/qgis-saved` for the reader
tests. Exits 1 when any check fails; the PNGs are in `<dir>/renders` for a person to look at.
"""

import json
import os
import sys

from qgis.core import (
    Qgis,
    QgsSymbolLayerUtils,
    QgsApplication,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsExpression,
    QgsExpressionContext,
    QgsExpressionContextUtils,
    QgsLayoutExporter,
    QgsMapRendererSequentialJob,
    QgsMapSettings,
    QgsPrintLayout,
    QgsProject,
    QgsReadWriteContext,
    QgsRectangle,
    QgsRenderContext,
    QgsStyle,
    QgsVectorLayer,
)
from qgis.PyQt.QtCore import QSize
from qgis.PyQt.QtGui import QColor
from qgis.PyQt.QtXml import QDomDocument

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/w"
RENDERS = os.path.join(ROOT, "renders")
SAVED = os.path.join(ROOT, "qgis-saved")
os.makedirs(RENDERS, exist_ok=True)
os.makedirs(SAVED, exist_ok=True)

app = QgsApplication([], False)
app.initQgis()
VERSION = Qgis.version()
TAG = "qgis" + VERSION.split("-")[0].replace(".", "")
print("QGIS", VERSION)

results = []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name + (": " + str(detail) if detail else ""))


def renderer_symbols(renderer):
    """Clones of the renderer's symbols in rule order; `categories()` returns a temporary copy whose
    symbols are freed with it, so they are cloned while it is alive."""
    kind = renderer.type()
    if kind == "singleSymbol":
        return [renderer.symbol().clone()]
    if kind == "categorizedSymbol":
        categories = renderer.categories()
        return [category.symbol().clone() for category in categories]
    if kind == "RuleRenderer":
        return [rule.symbol().clone() for rule in renderer.rootRule().children()]
    return []


def render(layers, crs, extent, path, scale=10000, dpi=150):
    settings = QgsMapSettings()
    settings.setLayers(layers)
    settings.setDestinationCrs(crs)
    settings.setOutputDpi(dpi)
    width_mm = extent.width() / scale * 1000
    height_mm = extent.height() / scale * 1000
    settings.setOutputSize(QSize(int(width_mm / 25.4 * dpi), int(height_mm / 25.4 * dpi)))
    settings.setExtent(extent)
    settings.setBackgroundColor(QColor("white"))
    job = QgsMapRendererSequentialJob(settings)
    job.start()
    job.waitForFinished()
    image = job.renderedImage()
    image.save(path)
    return settings, image


manifest = json.load(open(os.path.join(ROOT, "manifest.json")))
albers = QgsCoordinateReferenceSystem("EPSG:3005")
wgs84 = QgsCoordinateReferenceSystem("EPSG:4326")
to_albers = QgsCoordinateTransform(wgs84, albers, QgsProject.instance())
loaded = []

for spec in manifest["layers"]:
    lid = spec["id"]
    shp = os.path.join(ROOT, "data", lid + ".shp")
    layer = QgsVectorLayer(shp, spec["name"], "ogr")
    check(lid + " shapefile opens", layer.isValid())
    check(lid + " .qml loaded by itself", layer.renderer().type() == spec["renderer"], layer.renderer().type())
    message, ok = layer.loadNamedStyle(os.path.join(ROOT, "data", lid + ".qml"))
    check(lid + " loadNamedStyle", ok, message)
    renderer = layer.renderer()
    check(lid + " renderer", renderer.type() == spec["renderer"], renderer.type())
    symbols = renderer_symbols(renderer)
    check(lid + " rule count", len(symbols) == len(spec["rules"]), "%d vs %d" % (len(symbols), len(spec["rules"])))
    for rule, symbol in zip(spec["rules"], symbols):
        classes = [sl.layerType() for sl in symbol.symbolLayers()]
        check("%s / %s symbol layers" % (lid, rule["label"]), classes == rule["classes"], classes)
        for sl in symbol.symbolLayers():
            sub = sl.subSymbol()
            if sub is not None:
                inner = [s.layerType() for s in sub.symbolLayers()]
                check("%s / %s %s sub-symbol" % (lid, rule["label"], sl.layerType()), len(inner) == 1, inner)
    labeling = layer.labeling()
    if spec["labelField"]:
        check(lid + " labels on", layer.labelsEnabled() and labeling is not None)
        if labeling is not None:
            check(lid + " label field", labeling.settings().fieldName == spec["labelField"], labeling.settings().fieldName)

    # Which rule draws each feature, as QGIS decides, against the rule PGMaps draws it with.
    settings = QgsMapSettings()
    settings.setLayers([layer])
    settings.setDestinationCrs(albers)
    settings.setExtent(to_albers.transformBoundingBox(layer.extent()))
    settings.setOutputSize(QSize(400, 400))
    context = QgsRenderContext.fromMapSettings(settings)
    context.expressionContext().appendScope(QgsExpressionContextUtils.layerScope(layer))
    renderer = layer.renderer().clone()
    renderer.startRender(context, layer.fields())
    # A symbol is matched to its rule by its properties: QGIS hands back copies.
    rule_symbols = [QgsSymbolLayerUtils.symbolProperties(symbol) for symbol in renderer_symbols(renderer)]
    rule_labels = [rule["label"] for rule in spec["rules"]]
    legend_labels = {item.ruleKey(): item.label() for item in renderer.legendSymbolItems()}
    for feature, expected in zip(layer.getFeatures(), spec["features"]):
        context.expressionContext().setFeature(feature)
        drawn = []
        if renderer.type() == "RuleRenderer":
            # symbolsForFeature also returns ELSE rules here; the legend keys follow what is drawn.
            keys = renderer.legendKeysForFeature(feature, context)
            drawn = [[legend_labels[key]] for key in keys if key in legend_labels]
        else:
            for symbol in renderer.symbolsForFeature(feature, context):
                properties = QgsSymbolLayerUtils.symbolProperties(symbol)
                drawn.append([label for label, own in zip(rule_labels, rule_symbols) if own == properties])
        ok = len(drawn) == 1 and expected["rule"] in drawn[0]
        check("%s feature %s drawn by" % (lid, json.dumps(expected["properties"])), ok, drawn)
        if renderer.type() == "RuleRenderer":
            expression_context = QgsExpressionContext()
            expression_context.appendScope(QgsExpressionContextUtils.layerScope(layer))
            expression_context.setFeature(feature)
            matches = [
                r.label()
                for r in renderer.rootRule().children()
                if not r.isElse() and QgsExpression(r.filterExpression()).evaluate(expression_context)
            ]
            check("%s feature %s matches one rule" % (lid, json.dumps(expected["properties"])), len(matches) <= 1, matches)
    renderer.stopRender(context)

    extent = to_albers.transformBoundingBox(layer.extent())
    extent.grow(max(extent.width(), extent.height()) * 0.08)
    png = os.path.join(RENDERS, "%s-%s.png" % (TAG, lid))
    render([layer], albers, extent, png)
    check(lid + " rendered", os.path.getsize(png) > 1000, png)
    message, ok = layer.saveNamedStyle(os.path.join(SAVED, lid + ".qml"))
    check(lid + " saved back from QGIS", ok, message)
    loaded.append(layer)

# The whole fixture, drawn bottom first as the document orders it.
everything = QgsRectangle()
for layer in loaded:
    everything.combineExtentWith(to_albers.transformBoundingBox(layer.extent()))
everything.grow(150)
render(list(reversed(loaded)), albers, everything, os.path.join(RENDERS, TAG + "-all-layers.png"))

# The project.
project = QgsProject.instance()
project.clear()
ok = project.read(os.path.join(ROOT, manifest["project"]))
check("project opens", ok, project.error() if hasattr(project, "error") else "")
check("project CRS", project.crs().authid() == "EPSG:3005", project.crs().authid())
layers = project.mapLayers().values()
check("project layer count", len(layers) == len(manifest["layers"]), len(layers))
for layer in layers:
    check("project layer %s valid" % layer.name(), layer.isValid(), layer.source())
tree_order = [node.layerId() for node in project.layerTreeRoot().findLayers()]
check("layer tree top first", tree_order == [spec["id"] for spec in reversed(manifest["layers"])], tree_order)
for spec in manifest["layers"]:
    layer = project.mapLayer(spec["id"])
    if layer is not None:
        check("project layer %s renderer" % spec["id"], layer.renderer().type() == spec["renderer"], layer.renderer().type())
layout = project.layoutManager().layoutByName(manifest["layoutName"])
check("layout present", layout is not None)
if layout is not None:
    ids = sorted(item.id() for item in layout.items() if hasattr(item, "id") and item.id())
    check("layout items", {"map", "title", "legend", "scalebar", "north_arrow"}.issubset(ids), ids)
    page = layout.pageCollection().page(0)
    size = page.pageSize()
    check("layout page tabloid", abs(size.width() - 431.8) < 0.1 and abs(size.height() - 279.4) < 0.1, "%s x %s" % (size.width(), size.height()))
    map_item = layout.itemById("map")
    if map_item is not None:
        check("layout map scale near 1:10,000", abs(map_item.scale() - 10000) < 150, map_item.scale())
    exporter = QgsLayoutExporter(layout)
    image_settings = QgsLayoutExporter.ImageExportSettings()
    image_settings.dpi = 100
    png = os.path.join(RENDERS, TAG + "-layout.png")
    result = exporter.exportToImage(png, image_settings)
    check("layout exported", result == QgsLayoutExporter.Success, result)
    layout.saveAsTemplate(os.path.join(SAVED, "layout.qpt"), QgsReadWriteContext())
default_view = project.viewSettings().defaultViewExtent()
project_extent = QgsRectangle(default_view) if not default_view.isEmpty() else everything
render(
    [node.layer() for node in project.layerTreeRoot().findLayers() if node.isVisible()],
    project.crs(),
    project_extent,
    os.path.join(RENDERS, TAG + "-project.png"),
)
project.write(os.path.join(SAVED, "project.qgs"))

# The template, loaded into a new layout of the open project.
template = QgsPrintLayout(project)
document = QDomDocument()
document.setContent(open(os.path.join(ROOT, manifest["template"]), encoding="utf-8").read())
items, ok = template.loadFromTemplate(document, QgsReadWriteContext())
check("template loads", ok and len(items) > 5, "%d items" % len(items))

# The style library.
style = QgsStyle()
style.createMemoryDatabase()
check("catalogue library imports", style.importXml(os.path.join(ROOT, "catalogue-library.xml")))
check("catalogue symbol count", style.symbolCount() == manifest["librarySymbols"], "%d vs %d" % (style.symbolCount(), manifest["librarySymbols"]))
names = style.symbolNames()
if names:
    check("library tags", len(style.tagsOfSymbol(QgsStyle.SymbolEntity, names[0])) >= 2, style.tagsOfSymbol(QgsStyle.SymbolEntity, names[0]))
fixture_style = QgsStyle()
fixture_style.createMemoryDatabase()
fixture_style.importXml(os.path.join(ROOT, "fixture-library.xml"))
fixture_style.exportXml(os.path.join(SAVED, "library.xml"))

json.dump({"qgis": VERSION, "results": results}, open(os.path.join(ROOT, TAG + "-results.json"), "w"), indent=2)
failed = [r for r in results if not r["ok"]]
print("%d checks, %d failed" % (len(results), len(failed)))
app.exitQgis()
sys.exit(1 if failed else 0)

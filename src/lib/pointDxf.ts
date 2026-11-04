import type { DxfSettings } from "../components/DxfExportSettings"

export type PointDxfPoint = {
  rowNumber: number
  pointId: string
  easting: number
  northing: number
  elevation: number | null
  code: string
  valid: boolean
}

function sanitizeLayerName(code: string) {
  const cleaned = code
    .trim()
    .toUpperCase()
    // R12 symbol names allow at most 31 ASCII letters, digits, $, _ and -.
    .replace(/[^A-Z0-9_$-]/g, "_")
    .slice(0, 31)

  return cleaned || "SURVEY_POINTS"
}

function cleanDxfText(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim()
}

function getPointLayer(
  point: PointDxfPoint,
  settings: DxfSettings,
) {
  if (settings.layerByCode && point.code.trim()) {
    return sanitizeLayerName(point.code)
  }

  return "SURVEY_POINTS"
}

export function createPointDxf(
  points: PointDxfPoint[],
  settings: DxfSettings,
  options: { metres?: boolean; flatten?: boolean } = {},
) {
  const validPoints = points.filter((point) => point.valid)

  const layers = Array.from(
    new Set([
      "0",
      ...validPoints.map((point) =>
        getPointLayer(point, settings),
      ),
    ]),
  )

  const dxf: string[] = []
  let nextHandle = 0x100, handSeedIndex = -1
  const handle = () => (nextHandle++).toString(16).toUpperCase()

  function add(code: number, value: string | number) {
    dxf.push(String(code))
    dxf.push(String(value))
  }

  function table(name: string, count: number, tableHandle: string) {
    add(0, "TABLE")
    add(2, name)
    if (options.metres) { add(5, tableHandle); add(330, "0"); add(100, "AcDbSymbolTable") }
    add(70, count)
  }
  function symbolRecord(owner: string, subclass: string, recordHandle = handle()) {
    if (options.metres) { add(5, recordHandle); add(330, owner); add(100, "AcDbSymbolTableRecord"); add(100, subclass) }
  }

  function addText(
    layer: string,
    x: number,
    y: number,
    z: number,
    text: string,
  ) {
    if (!text.trim()) {
      return
    }

    add(0, "TEXT")
    if (options.metres) { add(5, handle()); add(330, "20"); add(100, "AcDbEntity") }
    add(8, layer)
    if (options.metres) add(100, "AcDbText")
    add(10, x)
    add(20, y)
    add(30, z)
    add(40, settings.textHeight)
    add(1, cleanDxfText(text))
    add(7, "STANDARD")
    if (options.metres) add(100, "AcDbText")
  }

  add(0, "SECTION")
  add(2, "HEADER")
  add(9, "$ACADVER")
  add(1, options.metres ? "AC1021" : "AC1009")
  if (options.metres) { add(9, "$INSUNITS"); add(70, 6) }
  if (options.metres) { add(9, "$HANDSEED"); add(5, "0"); handSeedIndex = dxf.length - 1 }
  add(0, "ENDSEC")

  add(0, "SECTION")
  add(2, "TABLES")

  // Define the linetype and text style referenced by the exported entities.
  table("LTYPE", 1, "10")
  add(0, "LTYPE")
  symbolRecord("10", "AcDbLinetypeTableRecord")
  add(2, "CONTINUOUS")
  add(70, 0)
  add(3, "Solid line")
  add(72, 65)
  add(73, 0)
  add(40, 0)
  add(0, "ENDTAB")

  table("STYLE", 1, "11")
  add(0, "STYLE")
  symbolRecord("11", "AcDbTextStyleTableRecord")
  add(2, "STANDARD")
  add(70, 0)
  add(40, 0)
  add(41, 1)
  add(50, 0)
  add(71, 0)
  add(42, settings.textHeight)
  add(3, "txt")
  add(4, "")
  add(0, "ENDTAB")

  table("LAYER", layers.length, "12")

  layers.forEach((layer) => {
    add(0, "LAYER")
    symbolRecord("12", "AcDbLayerTableRecord")
    add(2, layer)
    add(70, 0)
    add(62, 7)
    add(6, "CONTINUOUS")
  })

  add(0, "ENDTAB")
  if (options.metres) {
    table("BLOCK_RECORD", 2, "13")
    for (const [name, owner] of [["*Model_Space", "20"], ["*Paper_Space", "21"]]) {
      add(0, "BLOCK_RECORD"); symbolRecord("13", "AcDbBlockTableRecord", owner); add(2, name); add(70, 0)
    }
    add(0, "ENDTAB")
  }
  add(0, "ENDSEC")

  add(0, "SECTION")
  add(2, "BLOCKS")
  if (options.metres) for (const [name, owner] of [["*Model_Space", "20"], ["*Paper_Space", "21"]]) {
    add(0, "BLOCK"); add(5, handle()); add(330, owner); add(100, "AcDbEntity"); add(8, "0"); add(100, "AcDbBlockBegin")
    add(2, name); add(70, 0); add(10, 0); add(20, 0); add(30, 0); add(3, name); add(1, "")
    add(0, "ENDBLK"); add(5, handle()); add(330, owner); add(100, "AcDbEntity"); add(8, "0"); add(100, "AcDbBlockEnd")
  }
  add(0, "ENDSEC")

  add(0, "SECTION")
  add(2, "ENTITIES")

  validPoints.forEach((point) => {
    const layer = getPointLayer(point, settings)
    const elevation = options.flatten ? 0 : point.elevation ?? 0

    const offset = Math.max(
      settings.textHeight * 1.5,
      0.15,
    )

    if (settings.includePoint) {
      add(0, "POINT")
      if (options.metres) { add(5, handle()); add(330, "20"); add(100, "AcDbEntity") }
      add(8, layer)
      if (options.metres) add(100, "AcDbPoint")
      add(10, point.easting)
      add(20, point.northing)
      add(30, elevation)
    }

    if (settings.includePointId) {
      addText(
        layer,
        point.easting + offset,
        point.northing + offset,
        elevation,
        point.pointId,
      )
    }

    if (
      settings.includeElevation &&
      point.elevation !== null
    ) {
      addText(
        layer,
        point.easting + offset,
        point.northing - offset,
        elevation,
        point.elevation.toFixed(3),
      )
    }

    if (
      settings.includeCode &&
      point.code.trim()
    ) {
      addText(
        layer,
        point.easting + offset,
        point.northing - offset * 2.5,
        elevation,
        point.code,
      )
    }
  })

  add(0, "ENDSEC")
  add(0, "EOF")
  if (handSeedIndex >= 0) dxf[handSeedIndex] = handle()

  return `${dxf.join("\r\n")}\r\n`
}


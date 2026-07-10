import { useMemo, useState } from "react"
import type { ChangeEvent } from "react"
import {
ArrowLeft,
CheckCircle2,
Download,
FileWarning,
Layers3,
Upload,
} from "lucide-react"

import DxfExportSettings from "../components/DxfExportSettings"
import type { DxfSettings } from "../components/DxfExportSettings"
import { Link } from "react-router-dom"

type ColumnMapping = {
  pointId: number
  easting: number
  northing: number
  elevation: number
  code: number
}

type MappingKey = keyof ColumnMapping

type SurveyPoint = {
  rowNumber: number
  pointId: string
  easting: number
  northing: number
  elevation: number
  code: string
  valid: boolean
}

function sanitizeLayerName(code: string) {
  const cleaned = code
    .trim()
    .toUpperCase()
    .replace(/[<>/\\":;?*|=,]/g, "_")

  return cleaned || "SURVEY_POINTS"
}

function cleanDxfText(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim()
}

function getPointLayer(
  point: SurveyPoint,
  settings: DxfSettings,
) {
  if (settings.layerByCode) {
    return sanitizeLayerName(point.code)
  }

  return "SURVEY_POINTS"
}

function createDxf(
  points: SurveyPoint[],
  settings: DxfSettings,
) {
  const validPoints = points.filter((point) => point.valid)

  const layers = Array.from(
    new Set(
      validPoints.map((point) =>
        getPointLayer(point, settings),
      ),
    ),
  )

  const dxf: string[] = []

  function add(code: number, value: string | number) {
    dxf.push(String(code))
    dxf.push(String(value))
  }

  function addText(
    layer: string,
    x: number,
    y: number,
    z: number,
    text: string,
  ) {
    if (!text.trim()) return

    add(0, "TEXT")
    add(8, layer)
    add(10, x)
    add(20, y)
    add(30, z)
    add(40, settings.textHeight)
    add(1, cleanDxfText(text))
    add(7, "STANDARD")
  }

  add(0, "SECTION")
  add(2, "HEADER")
  add(9, "$ACADVER")
  add(1, "AC1009")
  add(0, "ENDSEC")

  add(0, "SECTION")
  add(2, "TABLES")

  add(0, "TABLE")
  add(2, "LAYER")
  add(70, layers.length)

  layers.forEach((layer) => {
    add(0, "LAYER")
    add(2, layer)
    add(70, 0)
    add(62, 7)
    add(6, "CONTINUOUS")
  })

  add(0, "ENDTAB")
  add(0, "ENDSEC")

  add(0, "SECTION")
  add(2, "ENTITIES")

  validPoints.forEach((point) => {
    const layer = getPointLayer(point, settings)

    const offset = Math.max(
      settings.textHeight * 1.5,
      0.15,
    )

    if (settings.includePoint) {
      add(0, "POINT")
      add(8, layer)
      add(10, point.easting)
      add(20, point.northing)
      add(30, point.elevation)
    }

    if (settings.includePointId) {
      addText(
        layer,
        point.easting + offset,
        point.northing + offset,
        point.elevation,
        point.pointId,
      )
    }

    if (settings.includeElevation) {
      addText(
        layer,
        point.easting + offset,
        point.northing - offset,
        point.elevation,
        point.elevation.toFixed(3),
      )
    }

    if (settings.includeCode) {
      addText(
        layer,
        point.easting + offset,
        point.northing - offset * 2.5,
        point.elevation,
        point.code,
      )
    }
  })

  add(0, "ENDSEC")
  add(0, "EOF")

  return `${dxf.join("\r\n")}\r\n`
}

export default function CsvToDxf() {
  const [fileName, setFileName] = useState("")
  const [rows, setRows] = useState<string[][]>([])
  const [hasHeader, setHasHeader] = useState(false)

  const [mapping, setMapping] = useState<ColumnMapping>({
    pointId: 0,
    easting: 1,
    northing: 2,
    elevation: 3,
    code: 4,
  })

  const [settings, setSettings] = useState<DxfSettings>({
    includePoint: true,
    includePointId: true,
    includeElevation: false,
    includeCode: false,
    layerByCode: true,
    textHeight: 0.4,
  })

  function looksLikeHeader(row: string[]) {
    const joined = row.join(" ").toLowerCase()

    return (
      joined.includes("point") ||
      joined.includes("easting") ||
      joined.includes("northing") ||
      joined.includes("elevation") ||
      joined.includes("level") ||
      joined.includes("code")
    )
  }

  function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]

    if (!file) return

    setFileName(file.name)

    const reader = new FileReader()

    reader.onload = () => {
      const text = reader.result

      if (typeof text !== "string") return

      const parsedRows = text
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "")
        .map((line) =>
          line.split(",").map((cell) => cell.trim()),
        )

      const headerDetected =
        parsedRows.length > 0 &&
        looksLikeHeader(parsedRows[0])

      setHasHeader(headerDetected)
      setRows(parsedRows)
    }

    reader.readAsText(file)
  }

  function updateMapping(
    key: MappingKey,
    value: string,
  ) {
    setMapping((current) => ({
      ...current,
      [key]: Number(value),
    }))
  }

  function getColumnName(index: number) {
    if (hasHeader && rows[0]?.[index]) {
      return rows[0][index]
    }

    return `Column ${index + 1}`
  }

  function getColumnExample(index: number) {
    const exampleRowIndex = hasHeader ? 1 : 0
    return rows[exampleRowIndex]?.[index] ?? ""
  }

  const columnCount = rows[0]?.length ?? 0

  const columnIndexes = Array.from(
    { length: columnCount },
    (_, index) => index,
  )

  const dataRows = hasHeader ? rows.slice(1) : rows
  const previewRows = dataRows.slice(0, 10)

  const surveyPoints = useMemo<SurveyPoint[]>(() => {
    const sourceRows = hasHeader
      ? rows.slice(1)
      : rows

    return sourceRows.map((row, index) => {
      const pointId =
        row[mapping.pointId]?.trim() ?? ""

      const easting = Number(row[mapping.easting])
      const northing = Number(row[mapping.northing])
      const elevation = Number(row[mapping.elevation])

      const code =
        row[mapping.code]?.trim() ?? ""

      const valid =
        pointId.length > 0 &&
        Number.isFinite(easting) &&
        Number.isFinite(northing) &&
        Number.isFinite(elevation)

      return {
        rowNumber: index + (hasHeader ? 2 : 1),
        pointId,
        easting,
        northing,
        elevation,
        code,
        valid,
      }
    })
  }, [rows, hasHeader, mapping])

  const validPoints = surveyPoints.filter(
    (point) => point.valid,
  )

  const invalidPoints = surveyPoints.filter(
    (point) => !point.valid,
  )

  const uniqueCodes = new Set(
    validPoints
      .map((point) => point.code)
      .filter((code) => code.length > 0),
  )

  const hasExportContent =
    settings.includePoint ||
    settings.includePointId ||
    settings.includeElevation ||
    settings.includeCode

  function handleDownloadDxf() {
    if (
      validPoints.length === 0 ||
      !hasExportContent
    ) {
      return
    }

    const content = createDxf(
      validPoints,
      settings,
    )

    const blob = new Blob([content], {
      type: "application/dxf;charset=utf-8",
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")

    const baseName =
      fileName.replace(/\.[^/.]+$/, "") ||
      "survey-points"

    link.href = url
    link.download = `${baseName}.dxf`

    document.body.appendChild(link)
    link.click()
    link.remove()

    window.setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1000)
  }

  const mappingFields: {
    key: MappingKey
    label: string
  }[] = [
    { key: "pointId", label: "Point ID" },
    { key: "easting", label: "Easting" },
    { key: "northing", label: "Northing" },
    { key: "elevation", label: "Elevation" },
    { key: "code", label: "Feature Code" },
  ]

  return (
    <div className="relative z-10 min-h-screen px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <Link
  to="/"
  className="mb-10 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-cyan-300"
>
  <ArrowLeft size={18} />
  Back to home
</Link>
        <div className="mb-10">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            SurveyTool
          </p>

          <h1 className="mt-4 text-5xl font-bold">
            CSV → DXF
          </h1>

          <p className="mt-4 max-w-2xl text-slate-400">
            Upload your survey CSV, map its columns,
            choose the DXF settings and download the
            finished drawing.
          </p>
        </div>

        <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-white/5 px-8 py-20 transition hover:border-cyan-400">
          <Upload
            size={40}
            className="mb-5 text-cyan-300"
          />

          <div className="text-xl font-semibold">
            Choose CSV File
          </div>

          <div className="mt-2 text-slate-400">
            Click here to browse
          </div>

          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileChange}
          />
        </label>

        {fileName && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
            <strong>Selected File:</strong>{" "}
            {fileName}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="mt-8 rounded-3xl border border-cyan-500/20 bg-cyan-500/10 p-6">
              <h2 className="text-xl font-semibold">
                Column Mapping
              </h2>

              <p className="mt-2 text-sm text-slate-400">
                Check that each survey field is matched
                to the correct CSV column.
              </p>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {mappingFields.map((field) => (
                  <label
                    key={field.key}
                    className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
                  >
                    <span className="mb-2 block text-sm text-slate-300">
                      {field.label}
                    </span>

                    <select
                      value={mapping[field.key]}
                      onChange={(event) =>
                        updateMapping(
                          field.key,
                          event.target.value,
                        )
                      }
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
                    >
                      {columnIndexes.map((index) => (
                        <option
                          key={index}
                          value={index}
                        >
                          {getColumnName(index)}
                          {getColumnExample(index)
                            ? ` — ${getColumnExample(index)}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <h2 className="text-xl font-semibold">
                Data Check
              </h2>

              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <Layers3
                    className="text-cyan-300"
                    size={24}
                  />

                  <div className="mt-4 text-3xl font-bold">
                    {surveyPoints.length}
                  </div>

                  <div className="mt-1 text-sm text-slate-400">
                    Total records
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5">
                  <CheckCircle2
                    className="text-emerald-300"
                    size={24}
                  />

                  <div className="mt-4 text-3xl font-bold">
                    {validPoints.length}
                  </div>

                  <div className="mt-1 text-sm text-slate-400">
                    Valid points
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5">
                  <FileWarning
                    className="text-amber-300"
                    size={24}
                  />

                  <div className="mt-4 text-3xl font-bold">
                    {invalidPoints.length}
                  </div>

                  <div className="mt-1 text-sm text-slate-400">
                    Invalid points
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <Layers3
                    className="text-cyan-300"
                    size={24}
                  />

                  <div className="mt-4 text-3xl font-bold">
                    {uniqueCodes.size}
                  </div>

                  <div className="mt-1 text-sm text-slate-400">
                    Feature codes
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8">
              <DxfExportSettings
                settings={settings}
                onChange={setSettings}
              />
            </div>

            <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">
                    Generate DXF
                  </h2>

                  <p className="mt-2 text-sm text-slate-400">
                    Export {validPoints.length} valid
                    survey points using the selected
                    settings.
                  </p>

                  {!hasExportContent && (
                    <p className="mt-2 text-sm text-amber-300">
                      Select at least one export option.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={
                    validPoints.length === 0 ||
                    !hasExportContent
                  }
                  onClick={handleDownloadDxf}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-400 px-7 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Download size={20} />
                  Download DXF
                </button>
              </div>
            </div>

            <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10">
              <table className="min-w-full text-left">
                <thead className="bg-white/5 text-sm text-slate-400">
                  <tr>
                    {columnIndexes.map((index) => (
                      <th
                        key={index}
                        className="whitespace-nowrap px-5 py-4 font-medium"
                      >
                        {getColumnName(index)}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {previewRows.map(
                    (row, rowIndex) => (
                      <tr
                        key={rowIndex}
                        className="border-t border-white/10"
                      >
                        {columnIndexes.map(
                          (columnIndex) => (
                            <td
                              key={columnIndex}
                              className="whitespace-nowrap px-5 py-4"
                            >
                              {row[columnIndex] ?? ""}
                            </td>
                          ),
                        )}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
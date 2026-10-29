export type MapCrs = {
  code: string
  name: string
  proj4: string
  canonicalProj4?: string
  area: string
  bbox: [number, number, number, number] | null
  unit: string
  note?: string
}

export const localGridCode = "LOCAL"

let cataloguePromise: Promise<MapCrs[]> | null = null

export function loadCrsCatalogue(): Promise<MapCrs[]> {
  if (!cataloguePromise) {
    cataloguePromise = fetch(`${import.meta.env.BASE_URL}data/coordinate-systems.json?v=2`)
      .then(async (response) => {
        if (!response.ok) throw new Error("The coordinate-system catalogue could not be loaded.")
        const records: MapCrs[] = await response.json()
        if (!Array.isArray(records) || !records.length) throw new Error("The coordinate-system catalogue is unavailable.")
        return records
      })
      .catch((error) => {
        cataloguePromise = null
        throw error
      })
  }
  return cataloguePromise
}

export function normaliseCrsText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function declaredEpsgCode(metadata?: Record<string, string>): string | null {
  if (!metadata) return null
  for (const [name, value] of Object.entries(metadata)) {
    if (/^(epsg|epsgCode)$/i.test(name) && /^\d{4,6}$/.test(value.trim())) return `EPSG:${value.trim()}`
  }
  for (const [name, value] of Object.entries(metadata)) {
    const explicit = value.match(/\bEPSG\s*(?:::?|=|\/(?:0\/)?|\s)\s*(?:(?:0|\d+\.\d+)[:/])?(\d{4,6})\b/i)
    if (explicit) return `EPSG:${explicit[1]}`
    if (/wkt/i.test(name)) {
      const authorities = [...value.matchAll(/(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)]
      if (authorities.length) return `EPSG:${authorities[authorities.length - 1][1]}`
    }
  }
  return null
}

const aliases: Record<string, string> = {
  nztm: "EPSG:2193",
  nztm2000: "EPSG:2193",
  "nztm 2000": "EPSG:2193",
  "mount eden 2000": "EPSG:2105",
  "nzgd2000 mount eden 2000": "EPSG:2105",
  "british national grid": "EPSG:27700",
  "osgb 1936 british national grid": "EPSG:27700",
  "wgs 84": "EPSG:4326",
  wgs84: "EPSG:4326",
}

export function detectFileCrs(metadata: Record<string, string> | undefined, catalogue: MapCrs[]): string | null {
  const explicit = declaredEpsgCode(metadata)
  if (explicit) return explicit
  if (!metadata) return null
  const name = normaliseCrsText(metadata.name ?? metadata.desc ?? "")
  if (!name) return null
  return aliases[name] ?? catalogue.find((entry) => normaliseCrsText(entry.name) === name)?.code ?? null
}

export function searchCrsCatalogue(catalogue: MapCrs[], query: string, country: string) {
  const tokens = normaliseCrsText(query.replace(/epsg\s*:/ig, "")).split(" ").filter(Boolean)
  const countryAliases: Record<string, string> = { nz: "new zealand", uk: "united kingdom", usa: "united states", us: "united states", au: "australia", tr: "turkey" }
  const region = countryAliases[normaliseCrsText(country)] ?? normaliseCrsText(country)
  const aliasCode = aliases[normaliseCrsText(query)]
  return catalogue.filter((entry) => {
    const searchable = normaliseCrsText(`${entry.code} ${entry.name} ${entry.area}`)
    const area = normaliseCrsText(`${entry.area} ${entry.name}`).replace(/turkiye/g, "turkey")
    return (entry.code === aliasCode || tokens.every((token) => searchable.includes(token))) && (!region || area.includes(region.replace(/turkiye/g, "turkey")))
  }).sort((a, b) => {
    const exact = query.trim().replace(/^EPSG\s*:/i, "")
    if (a.code === `EPSG:${exact}`) return -1
    if (b.code === `EPSG:${exact}`) return 1
    return Number(a.code.slice(5)) - Number(b.code.slice(5))
  })
}

export function metresPerLinearUnit(unit: string): number | null {
  const value = unit.toLowerCase().replace(/[\s_-]/g, "")
  if (["meter", "metre", "meters", "metres", "m", "metric"].includes(value)) return 1
  if (["foot", "feet", "ft", "internationalfoot"].includes(value)) return 0.3048
  if (["ussurveyfoot", "usfoot", "surveyfoot", "usft", "footus"].includes(value)) return 1200 / 3937
  if (["millimeter", "millimetre", "mm"].includes(value)) return 0.001
  if (["centimeter", "centimetre", "cm"].includes(value)) return 0.01
  if (["kilometer", "kilometre", "km"].includes(value)) return 1000
  if (["inch", "inches", "in"].includes(value)) return 0.0254
  return null
}

export function crsUnitScale(crs: MapCrs): number | null {
  const definitionUnit = crs.proj4.match(/\+units=([^\s]+)/)?.[1]
  const explicitScale = Number(crs.proj4.match(/\+to_meter=([^\s]+)/)?.[1])
  if (Number.isFinite(explicitScale) && explicitScale > 0) return explicitScale
  return metresPerLinearUnit(definitionUnit ?? crs.unit)
}

export function isGeographicCrs(crs: MapCrs) {
  return /\+proj=(longlat|latlong)\b/.test(crs.proj4) || /^\s*(GEOGCS|GEOGCRS)\s*\[/i.test(crs.proj4)
}

export type Basemap = "street" | "aerial" | "none"
export type MapProjectSettings = {
  sourceCrs: Record<string, string>
  defaultCrs: string
  basemap: Basemap
  opacity: number
}

export const defaultMapSettings: MapProjectSettings = { sourceCrs: {}, defaultCrs: "", basemap: "street", opacity: 75 }

export function readMapSettings(key: string, storage?: Pick<Storage, "getItem"> | null): MapProjectSettings {
  try {
    const raw = (storage === undefined ? window.localStorage : storage)?.getItem(`surveytool:map:v1:${key}`)
    if (!raw) return { ...defaultMapSettings, sourceCrs: {} }
    const saved = JSON.parse(raw)
    const sourceCrs: Record<string, string> = Object.create(null)
    for (const [name, code] of Object.entries(saved.sourceCrs ?? {})) {
      if (typeof code === "string" && /^(EPSG:\d{4,6}|LOCAL)$/.test(code)) sourceCrs[name] = code
    }
    return {
      sourceCrs,
      defaultCrs: typeof saved.defaultCrs === "string" && /^(EPSG:\d{4,6}|LOCAL)$/.test(saved.defaultCrs) ? saved.defaultCrs : "",
      basemap: ["street", "aerial", "none"].includes(saved.basemap) ? saved.basemap : "street",
      opacity: typeof saved.opacity === "number" && Number.isFinite(saved.opacity) ? Math.min(100, Math.max(0, saved.opacity)) : 75,
    }
  } catch {
    return { ...defaultMapSettings, sourceCrs: {} }
  }
}

export function saveMapSettings(key: string, settings: MapProjectSettings, storage?: Pick<Storage, "setItem"> | null): boolean {
  try {
    const target = storage === undefined ? window.localStorage : storage
    if (!target) return false
    target.setItem(`surveytool:map:v1:${key}`, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}

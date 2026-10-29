import countryNames from "./crsCountries.json"
import countryAliases from "./crsCountryAliases.json"
import type { MapCrs } from "./mapCoordinates"

export const crsCountries = Object.entries(countryNames).map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"))

export function normaliseCountryText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
}

const countryLookup = new Map(crsCountries.flatMap(({ code, name }) =>
  [code, name, ...(countryAliases[code as keyof typeof countryAliases] ?? [])]
    .map((alias) => [normaliseCountryText(alias), code] as const)))
export function resolveCrsCountry(value: string) { return countryLookup.get(normaliseCountryText(value)) ?? "" }

export function countryMatchesCrs(crs: MapCrs, country: string) {
  if (!country) return true
  const code = resolveCrsCountry(country)
  if (!code) return normaliseCountryText(crs.area).includes(normaliseCountryText(country))
  if (crs.global || /^World\b/i.test(crs.area)) return true
  if (crs.countries) return crs.countries.includes(code)
  // Old/custom catalogue records remain searchable while a new catalogue loads.
  const name = countryNames[code as keyof typeof countryNames]
  return [name, ...(countryAliases[code as keyof typeof countryAliases] ?? [])]
    .some((alias) => ` ${normaliseCountryText(crs.area)} `.includes(` ${normaliseCountryText(alias)} `))
}

const common: Record<string, number[]> = {
  NZ: [2193, 2105, 4167], TR: [5254, 5255, 5256, 5257, 5258, 5259, 5260, 5261],
  AU: [7855, 7856, 7854, 28355, 28356], GB: [27700, 4258], IE: [2157, 29903],
  US: [5070, 4269], CA: [3978, 3347, 4617], FR: [2154], DE: [25832, 25833],
  IT: [25832, 25833, 3003, 3004], ES: [25830, 25831, 25829], NL: [28992],
  PH: [3123, 3124, 3125], SG: [3414], IN: [7755], ZA: [2054], JP: [6668],
}

export function commonCrsCodes(catalogue: MapCrs[], country: string) {
  const code = resolveCrsCountry(country)
  const preferred = [...(common[code] ?? []), 4326, 3857].map((value) => `EPSG:${value}`)
  const localUtm = code ? catalogue.filter((entry) => /^WGS 84 \/ UTM zone /i.test(entry.name) && entry.countries?.includes(code)).map((entry) => entry.code) : []
  return [...new Set([...preferred, ...localUtm])]
}

export function requiredDatumGrids(crs: MapCrs) {
  return ((crs.canonicalProj4 ?? crs.proj4).match(/\+nadgrids=([^\s]+)/)?.[1] ?? "")
    .split(",").filter((name) => name && name !== "@null" && name !== "null")
}

export type CrsPickerPreferences = { country: string; recent: string[] }
export const crsPickerStorageKey = "surveytool:crs-picker:v1"
export function readCrsPickerPreferences(storage?: Pick<Storage, "getItem">): CrsPickerPreferences {
  try {
    const value = JSON.parse((storage ?? window.localStorage).getItem(crsPickerStorageKey) ?? "null")
    return {
      country: typeof value?.country === "string" ? resolveCrsCountry(value.country) : "",
      recent: Array.isArray(value?.recent) ? [...new Set(value.recent.filter((code: unknown): code is string => typeof code === "string" && /^EPSG:\d{4,6}$/.test(code)))].slice(0, 8) as string[] : [],
    }
  } catch { return { country: "", recent: [] } }
}

export function saveCrsPickerPreferences(value: CrsPickerPreferences, storage?: Pick<Storage, "setItem">) {
  try { (storage ?? window.localStorage).setItem(crsPickerStorageKey, JSON.stringify(value)); return true }
  catch { return false }
}

import { readFileSync } from "node:fs"

// ISO country/territory names from umpirsky/country-list (MIT); Kosovo is
// included because it is separately named in EPSG areas of use.
const names = JSON.parse(readFileSync(new URL("../src/lib/crsCountries.json", import.meta.url), "utf8"))
export const countryAliases = JSON.parse(readFileSync(new URL("../src/lib/crsCountryAliases.json", import.meta.url), "utf8"))
const countryAreas = JSON.parse(readFileSync(new URL("./data/country-areas.json", import.meta.url), "utf8")).countries

function longitudeParts(west, east) { return west > east ? [[west, 180], [-180, east]] : [[west, east]] }
export function countriesForGlobalGrid(entry) {
  if (!/^WGS 84 \/ (UTM zone |UPS )/.test(entry.name) || !entry.bbox) return []
  const [north, west, south, east] = entry.bbox
  return Object.entries(countryAreas).filter(([, boxes]) => boxes.some(([n, w, s, e]) =>
    Math.min(north, n) > Math.max(south, s) && longitudeParts(west, east).some(([a, b]) =>
      longitudeParts(w, e).some(([c, d]) => Math.min(b, d) > Math.max(a, c)))))
    .map(([code]) => code)
}

export function normalise(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
}

const phrases = Object.entries(names).flatMap(([code, name]) => {
  const variants = [name, name.replace(/\bSt\./g, "Saint"), ...(countryAliases[code] ?? [])]
  return [...new Set(variants.map(normalise))].map((phrase) => ({ code, phrase }))
}).sort((a, b) => b.phrase.length - a.phrase.length)

export function countriesForArea(area) {
  // Match longest names first so e.g. American Samoa does not match Samoa,
  // Democratic Republic of the Congo does not match Congo, and Guinea-Bissau
  // does not match Guinea. Use area metadata, never CRS-name substrings.
  let remaining = ` ${normalise(area)} `
  const codes = new Set()
  for (const { code, phrase } of phrases) {
    if (code === "GE" && /united states|\busa\b/i.test(area) && !/^Georgia\b/i.test(area)) continue
    if (code === "JE" && /new jersey/i.test(area) && !/channel islands|^Jersey\b/i.test(area)) continue
    if (code === "GB" && /united states|\busa\b/i.test(area) && !/united kingdom|great britain/i.test(area)) continue
    const needle = ` ${phrase} `
    if (!remaining.includes(needle)) continue
    codes.add(code)
    remaining = remaining.replaceAll(needle, " ")
  }
  return [...codes].sort()
}

export const crsCountries = Object.entries(names).map(([code, name]) => ({
  code, name, aliases: countryAliases[code] ?? [],
})).sort((a, b) => a.name.localeCompare(b.name, "en"))

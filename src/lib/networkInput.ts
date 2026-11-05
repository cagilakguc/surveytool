import { parsePointFileText } from "./pointFile"
import { isAngular, secondsToRadians, validateNetwork, wrapAngle } from "./networkAdjustment"
import type { NetworkInput, NetworkMode, NetworkObservation, NetworkPoint, ObservationType } from "./networkAdjustment"

export type NetworkSettings = { name: string; mode: NetworkMode; grid: string; datum: string; distanceMm: number; distancePpm: number; edmModel: "additive" | "quadrature"; angularSeconds: number; levelMmPerSqrtKm: number }
export const defaultNetworkSettings: NetworkSettings = { name: "Control network", mode: "level", grid: "Local grid", datum: "NZVD2016", distanceMm: 2, distancePpm: 2, edmModel: "additive", angularSeconds: 5, levelMmPerSqrtKm: 1 }
const key = (value: string) => value.toLowerCase().replace(/[ _-]/g, "")
const pointHeaders = ["point", "easting", "northing", "rl", "fixed"]
const observationHeaders = ["id", "type", "from", "to", "back", "value", "sigma", "set", "lengthkm", "enabled"]
export function networkCsvRows(text: string, kind: "points" | "observations") {
  if (typeof text !== "string" || text.length > 1_000_000) throw new Error("Use CSV text smaller than 1 MB.")
  const clean = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim())
  if (clean.some(line => (line.match(/"/g)?.length ?? 0) % 2)) throw new Error("CSV quoted fields must close on the same line. Multiline fields are not supported.")
  const parsed = parsePointFileText(clean.join("\n")).rows
  if (parsed.length < 2) throw new Error(`Add a header and at least one ${kind === "points" ? "point" : "observation"} row.`)
  const headers = parsed[0].map(key), allowed = kind === "points" ? pointHeaders : observationHeaders
  if (new Set(headers).size !== headers.length || headers.some(h => !allowed.includes(h))) throw new Error(`Check ${kind} headers. Supported columns: ${allowed.join(", ")}.`)
  const required = kind === "points" ? ["point", "fixed"] : ["id", "type", "from", "to", "value"]
  if (required.some(h => !headers.includes(h))) throw new Error(`Required ${kind} headers: ${required.join(", ")}.`)
  if (parsed.slice(1).some(row => row.length !== headers.length)) throw new Error(`Each ${kind} row must have ${headers.length} columns. Keep empty cells between commas.`)
  return { headers, rows: parsed.slice(1) }
}
const number = (s: string, name: string) => {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s) || !Number.isFinite(Number(s))) throw new Error(`${name}: enter a finite decimal number, using a dot for decimals.`)
  return Number(s)
}
export function parseNetworkAngle(text: string) {
  let degrees: number
  if (text.includes(":")) {
    const match = text.match(/^([+-]?)(\d{1,3}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/)
    if (!match || Number(match[3]) >= 60 || Number(match[4]) >= 60) throw new Error(`Invalid DMS angle: ${text}. Use degrees:minutes:seconds.`)
    degrees = (Number(match[2]) + Number(match[3]) / 60 + Number(match[4]) / 3600) * (match[1] === "-" ? -1 : 1)
  } else degrees = number(text, "Angle")
  if (Math.abs(degrees) > 360) throw new Error("Angles must lie between -360 and 360 degrees. Gons and packed D.MMSS values are not supported.")
  return wrapAngle(degrees * Math.PI / 180)
}
function flag(value: string, fallback: boolean, name: string) {
  if (!value) return fallback
  if (["true", "1", "yes", "fixed"].includes(value.toLowerCase())) return true
  if (["false", "0", "no", "free"].includes(value.toLowerCase())) return false
  throw new Error(`${name}: use true or false.`)
}
export function parseNetwork(pointsText: string, observationsText: string, settings: NetworkSettings): NetworkInput {
  if (!settings || !["level", "horizontal"].includes(settings.mode) || !["additive", "quadrature"].includes(settings.edmModel) || ![settings.distanceMm, settings.distancePpm, settings.angularSeconds, settings.levelMmPerSqrtKm].every(Number.isFinite) || settings.distanceMm < 0 || settings.distancePpm < 0 || settings.angularSeconds <= 0 || settings.levelMmPerSqrtKm <= 0) throw new Error("Check the project observation standard deviations.")
  const p = networkCsvRows(pointsText, "points"), o = networkCsvRows(observationsText, "observations")
  if (p.rows.length > 80 || o.rows.length > 2000) throw new Error("This release accepts up to 80 points and 2,000 observations.")
  const points: NetworkPoint[] = p.rows.map((row, i) => {
    const at = (h: string) => row[p.headers.indexOf(h)] ?? "", optional = (h: string) => at(h) === "" ? null : number(at(h), `Point row ${i + 2}, ${h}`)
    return { id: at("point"), easting: optional("easting"), northing: optional("northing"), height: optional("rl"), fixed: flag(at("fixed"), false, `Point row ${i + 2}, Fixed`) }
  })
  const observations: NetworkObservation[] = o.rows.map((row, i) => {
    const at = (h: string) => row[o.headers.indexOf(h)] ?? "", type = at("type").toUpperCase() as ObservationType
    if (!["DH", "HD", "AZ", "HA", "DIR"].includes(type)) throw new Error(`Observation row ${i + 2}: use DH, HD, AZ, HA or DIR. Slope/zenith and raw-instrument records require reduction first.`)
    const angular = isAngular(type), value = angular ? parseNetworkAngle(at("value")) : number(at("value"), `Observation ${at("id")}, Value`), lengthKm = at("lengthkm") ? number(at("lengthkm"), `Observation ${at("id")}, Length_km`) : null
    let sigma: number, weightSource: string
    if (at("sigma")) { sigma = number(at("sigma"), `Observation ${at("id")}, Sigma`) * (angular ? secondsToRadians : .001); weightSource = "Explicit 1-sigma" }
    else if (angular) { sigma = settings.angularSeconds * secondsToRadians; weightSource = "Project angular sigma" }
    else if (type === "HD") { const ppmMm = Math.abs(value) * settings.distancePpm / 1000; sigma = (settings.edmModel === "additive" ? settings.distanceMm + ppmMm : Math.hypot(settings.distanceMm, ppmMm)) * .001; weightSource = settings.edmModel === "additive" ? "EDM constant + ppm" : "EDM quadrature" }
    else { if (lengthKm === null || lengthKm <= 0) throw new Error(`Level observation ${at("id")}: supply Sigma in mm or a positive Length_km for distance weighting.`); sigma = settings.levelMmPerSqrtKm * Math.sqrt(lengthKm) * .001; weightSource = "Level mm × sqrt(km)" }
    return { id: at("id"), type, from: at("from"), to: at("to"), back: at("back"), set: at("set"), value, sigma, lengthKm, weightSource, enabled: flag(at("enabled"), true, `Observation ${at("id")}, Enabled`) }
  })
  const input: NetworkInput = { name: settings.name.trim(), grid: settings.grid.trim(), datum: settings.datum.trim(), mode: settings.mode, points, observations }
  validateNetwork(input)
  return input
}
export function csvCell(value: string | number | boolean | null, spreadsheet = false) {
  let text = value === null ? "" : String(value)
  if (spreadsheet && typeof value === "string" && /^\s*[=+@-]/.test(text)) text = "'" + text
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
export function networkCsv(rows: Array<Array<string | number | boolean | null>>, spreadsheet = true) { return "\uFEFF" + rows.map(row => row.map(v => csvCell(v, spreadsheet)).join(",")).join("\r\n") + "\r\n" }
export function editObservationInclusion(text: string, id: string, enabled: boolean) {
  const parsed = networkCsvRows(text, "observations"), index = parsed.headers.indexOf("id")
  let include = parsed.headers.indexOf("enabled")
  if (include < 0) { include = parsed.headers.length; parsed.headers.push("enabled"); for (const row of parsed.rows) row.push("true") }
  const row = parsed.rows.find(r => r[index] === id)
  if (!row) throw new Error("Observation not found in source CSV.")
  row[include] = String(enabled)
  return networkCsv([parsed.headers, ...parsed.rows], false)
}
export function restoredNetworkSettings(value: unknown): NetworkSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved network settings.")
  const v = value as NetworkSettings
  if (![v.name, v.grid, v.datum].every(s => typeof s === "string") || !["level", "horizontal"].includes(v.mode) || !["additive", "quadrature"].includes(v.edmModel) || ![v.distanceMm, v.distancePpm, v.angularSeconds, v.levelMmPerSqrtKm].every(n => typeof n === "number" && Number.isFinite(n))) throw new Error("Invalid saved network settings.")
  return { name: v.name, grid: v.grid, datum: v.datum, mode: v.mode, edmModel: v.edmModel, distanceMm: v.distanceMm, distancePpm: v.distancePpm, angularSeconds: v.angularSeconds, levelMmPerSqrtKm: v.levelMmPerSqrtKm }
}

import type { LandXmlDocument } from "./landxml"
import { crsUnitScale, isGeographicCrs, metresPerLinearUnit } from "./mapCoordinates"
import type { MapCrs } from "./mapCoordinates"
import type { SurfaceComparison } from "./surfaceCompare"

export function mapInputUnitError(document: LandXmlDocument, crs: MapCrs): string {
  if (isGeographicCrs(crs)) return ""
  const fileScale = metresPerLinearUnit(document.units)
  const gridScale = crsUnitScale(crs)
  if (fileScale !== null && gridScale !== null && Math.abs(fileScale - gridScale) > 1e-9) {
    return `${document.fileName} declares ${document.units}, but ${crs.code} uses ${crs.unit}. Check the selected CRS or export the file in its matching units.`
  }
  return ""
}

export function comparisonCoordinateError(existing: LandXmlDocument, design: LandXmlDocument, existingCode: string, designCode: string, existingCrs: MapCrs | null, designCrs: MapCrs | null): string {
  if (existingCode && designCode && existingCode !== designCode) {
    return "The files have different coordinate systems. Export both surfaces in the same survey grid before comparing them."
  }
  if ((existingCrs && isGeographicCrs(existingCrs)) || (designCrs && isGeographicCrs(designCrs))) {
    return "Surface volumes need a projected survey grid with linear units. Re-export these geographic coordinates in a suitable local projected CRS."
  }
  for (const [document, crs] of [[existing, existingCrs], [design, designCrs]] as const) {
    if (crs) {
      const error = mapInputUnitError(document, crs)
      if (error) return error
    }
  }
  const existingScale = metresPerLinearUnit(existing.units) ?? (existingCrs ? crsUnitScale(existingCrs) : null)
  const designScale = metresPerLinearUnit(design.units) ?? (designCrs ? crsUnitScale(designCrs) : null)
  if (existingScale === null || designScale === null) return "The file units are not recognised. Select the correct projected coordinate system or export LandXML with explicit linear units."
  if (Math.abs(existingScale - designScale) > 1e-9) return "The surfaces use different linear units. Export both files in the same survey grid and units before comparing them."
  return ""
}

// Coordinates and cell size stay in the input grid for map placement. Results use metres.
export function metricSurfaceComparison(comparison: SurfaceComparison, scale: number): SurfaceComparison {
  if (scale === 1) return comparison
  return {
    ...comparison,
    cells: comparison.cells.map((cell) => ({ ...cell, difference: cell.difference * scale })),
    cutVolume: comparison.cutVolume * scale ** 3,
    fillVolume: comparison.fillVolume * scale ** 3,
    netVolume: comparison.netVolume * scale ** 3,
    minDifference: comparison.minDifference * scale,
    maxDifference: comparison.maxDifference * scale,
    averageDifference: comparison.averageDifference * scale,
    comparedArea: comparison.comparedArea * scale ** 2,
  }
}

import { useEffect, useMemo, useState } from "react"
import type { LandXmlDocument } from "./landxml"
import { detectFileCrs, loadCrsCatalogue, localGridCode, readMapSettings, saveMapSettings } from "./mapCoordinates"
import type { Basemap, MapCrs, MapProjectSettings } from "./mapCoordinates"

export type MapInputFile = { id: string; label: string; document: LandXmlDocument }

export function mapFileKey(document: LandXmlDocument) {
  return JSON.stringify([document.fileName, document.coordinateSystem ?? null])
}

export function mapProjectKey(files: MapInputFile[]) {
  const first = files[0]?.document
  return first && first.projectName !== "Unnamed project" ? first.projectName : first?.fileName ?? ""
}

export function useMapProject(files: MapInputFile[]) {
  const projectKey = mapProjectKey(files)
  const savedSettings = useMemo(() => readMapSettings(projectKey), [projectKey])
  const [updates, setUpdates] = useState<Record<string, MapProjectSettings>>({})
  const [catalogue, setCatalogue] = useState<MapCrs[]>([])
  const [catalogueError, setCatalogueError] = useState("")
  const [retry, setRetry] = useState(0)
  const [storageFailed, setStorageFailed] = useState(false)
  const settings = Object.hasOwn(updates, projectKey) ? updates[projectKey] : savedSettings

  useEffect(() => {
    if (!projectKey) return
    let active = true
    setCatalogueError("")
    loadCrsCatalogue().then((entries) => {
      if (active) setCatalogue(entries)
    }).catch((error) => {
      if (active) setCatalogueError(error instanceof Error ? error.message : "Coordinate systems could not be loaded.")
    })
    return () => { active = false }
  }, [projectKey, retry])

  function updateSettings(change: (previous: MapProjectSettings) => MapProjectSettings) {
    setUpdates((previous) => {
      const next = change(Object.hasOwn(previous, projectKey) ? previous[projectKey] : savedSettings)
      return { ...previous, [projectKey]: next }
    })
  }

  useEffect(() => {
    const changed = Object.hasOwn(updates, projectKey) ? updates[projectKey] : null
    if (projectKey && changed) setStorageFailed(!saveMapSettings(projectKey, changed))
  }, [projectKey, updates])

  const selections = files.map((file) => {
    const detected = detectFileCrs(file.document.coordinateSystem, catalogue)
    const saved = settings.sourceCrs[mapFileKey(file.document)]
    const code = saved ?? detected ?? settings.defaultCrs
    return {
      ...file,
      code,
      crs: catalogue.find((entry) => entry.code === code) ?? null,
      origin: saved ? "Saved file setting" : detected ? "Read from LandXML" : code ? "Saved project setting" : "Not specified in this file",
    }
  })

  return {
    projectKey, files, settings, selections, catalogue, catalogueError, storageFailed,
    loading: !!projectKey && catalogue.length === 0 && !catalogueError,
    retryCatalogue: () => setRetry((value) => value + 1),
    restoreSettings(key: string, value: MapProjectSettings) {
      setUpdates((previous) => ({ ...previous, [key]: value }))
    },
    setCrs(file: MapInputFile, code: string) {
      updateSettings((previous) => ({
        ...previous,
        defaultCrs: file.id === files[0]?.id ? code : previous.defaultCrs,
        sourceCrs: { ...previous.sourceCrs, [mapFileKey(file.document)]: code },
      }))
    },
    useFirstCrsForAll() {
      const first = selections[0]?.code
      if (!first || first === localGridCode) return
      updateSettings((previous) => ({
        ...previous, defaultCrs: first,
        sourceCrs: Object.fromEntries([...Object.entries(previous.sourceCrs), ...files.map((file) => [mapFileKey(file.document), first])]),
      }))
    },
    setBasemap(basemap: Basemap) { updateSettings((previous) => ({ ...previous, basemap })) },
    setOpacity(opacity: number) { updateSettings((previous) => ({ ...previous, opacity })) },
  }
}

export type MapProject = ReturnType<typeof useMapProject>

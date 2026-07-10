type DxfSettings = {
  includePoint: boolean
  includePointId: boolean
  includeElevation: boolean
  includeCode: boolean
  layerByCode: boolean
  textHeight: number
}

type DxfExportSettingsProps = {
  settings: DxfSettings
  onChange: (settings: DxfSettings) => void
  hasElevation: boolean
  hasCode: boolean
}

export type { DxfSettings }

export default function DxfExportSettings({
  settings,
  onChange,
  hasElevation,
  hasCode,
}: DxfExportSettingsProps) {
  function updateSetting<Key extends keyof DxfSettings>(
    key: Key,
    value: DxfSettings[Key],
  ) {
    onChange({
      ...settings,
      [key]: value,
    })
  }

  const activeCard =
    "flex items-center justify-between gap-6 rounded-2xl border border-white/10 bg-slate-950/40 p-4"

  const disabledCard =
    "flex items-center justify-between gap-6 rounded-2xl border border-white/5 bg-slate-950/20 p-4 opacity-50"

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-xl font-semibold">
        DXF Export Settings
      </h2>

      <p className="mt-2 text-sm text-slate-400">
        Choose which survey information should be included in the DXF.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className={activeCard}>
          <span>
            <span className="block font-medium">
              Point markers
            </span>

            <span className="mt-1 block text-sm text-slate-400">
              Export each survey record as a 3D point.
            </span>
          </span>

          <input
            type="checkbox"
            checked={settings.includePoint}
            onChange={(event) =>
              updateSetting("includePoint", event.target.checked)
            }
            className="h-5 w-5 shrink-0 accent-cyan-400"
          />
        </label>

        <label className={activeCard}>
          <span>
            <span className="block font-medium">
              Point ID labels
            </span>

            <span className="mt-1 block text-sm text-slate-400">
              Show the point name beside each point.
            </span>
          </span>

          <input
            type="checkbox"
            checked={settings.includePointId}
            onChange={(event) =>
              updateSetting("includePointId", event.target.checked)
            }
            className="h-5 w-5 shrink-0 accent-cyan-400"
          />
        </label>

        <label className={hasElevation ? activeCard : disabledCard}>
          <span>
            <span className="block font-medium">
              Elevation labels
            </span>

            <span className="mt-1 block text-sm text-slate-400">
              {hasElevation
                ? "Add the RL beside each survey point."
                : "Not available because no elevation column is selected."}
            </span>
          </span>

          <input
            type="checkbox"
            disabled={!hasElevation}
            checked={
              hasElevation && settings.includeElevation
            }
            onChange={(event) =>
              updateSetting("includeElevation", event.target.checked)
            }
            className="h-5 w-5 shrink-0 accent-cyan-400 disabled:cursor-not-allowed"
          />
        </label>

        <label className={hasCode ? activeCard : disabledCard}>
          <span>
            <span className="block font-medium">
              Feature code labels
            </span>

            <span className="mt-1 block text-sm text-slate-400">
              {hasCode
                ? "Display codes such as RPBC beside points."
                : "Not available because no feature-code column is selected."}
            </span>
          </span>

          <input
            type="checkbox"
            disabled={!hasCode}
            checked={hasCode && settings.includeCode}
            onChange={(event) =>
              updateSetting("includeCode", event.target.checked)
            }
            className="h-5 w-5 shrink-0 accent-cyan-400 disabled:cursor-not-allowed"
          />
        </label>

        <label className={hasCode ? activeCard : disabledCard}>
          <span>
            <span className="block font-medium">
              Layers by feature code
            </span>

            <span className="mt-1 block text-sm text-slate-400">
              {hasCode
                ? "Create separate layers such as RPBC and MH."
                : "All points will use the SURVEY_POINTS layer."}
            </span>
          </span>

          <input
            type="checkbox"
            disabled={!hasCode}
            checked={hasCode && settings.layerByCode}
            onChange={(event) =>
              updateSetting("layerByCode", event.target.checked)
            }
            className="h-5 w-5 shrink-0 accent-cyan-400 disabled:cursor-not-allowed"
          />
        </label>

        <label className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
          <span className="block font-medium">
            Text height
          </span>

          <span className="mt-1 block text-sm text-slate-400">
            Drawing units used for DXF labels.
          </span>

          <input
            type="number"
            min="0.01"
            step="0.05"
            value={settings.textHeight}
            onChange={(event) =>
              updateSetting(
                "textHeight",
                Math.max(
                  0.01,
                  Number(event.target.value) || 0.4,
                ),
              )
            }
            className="mt-4 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
          />
        </label>
      </div>
    </div>
  )
}
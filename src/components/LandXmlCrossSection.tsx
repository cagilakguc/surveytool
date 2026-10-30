import ReportDownloads from "./ReportDownloads"
import type { SurveyReport } from "../lib/surveyReports"
import { declaredEpsgCode, metresPerLinearUnit } from "../lib/mapCoordinates"
import { useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { X } from "lucide-react"

import type { LandXmlDocument, LandXmlSurface, PlanPoint } from "../lib/landxml"
import type { SurveyPointLayer } from "../lib/surveyPoints"
import { allSectionPointFiles, calculateSectionThickness, initialSectionSettings, reconcileSectionSettings, sectionPointLayers, sectionUnitLabel } from "../lib/sectionOptions"
import type { SectionLine, SectionSample as Sample, SectionSettings, SectionThickness as ThicknessStats } from "../lib/sectionOptions"
import { createSectionAnalysis } from "../lib/sectionAnalysis"
import type { SectionAnalysis, SectionSurveyPoint } from "../lib/sectionAnalysis"
import { horizontalAlignment } from "../lib/alignmentGeometry"
import { alignmentSectionRange, createAlignmentSections, maximumBatchSections } from "../lib/sectionBatch"
import type { SectionBook } from "../lib/sectionReports"
import SectionBookDownloads from "./SectionBookDownloads"
import CrossSectionWorkspaceMap from "./CrossSectionWorkspaceMap"

export type { SectionSettings } from "../lib/sectionOptions"

type Props = {
  document: LandXmlDocument
  pointLayers: SurveyPointLayer[]
  settings?:SectionSettings|null
  onSettingsChange?:(settings:SectionSettings)=>void
  onAddPointFiles?: () => void
}

type XY = { x: number; y: number }

const width = 1000
const height = 620
const padding = 34
const surfaceColours = ["#22d3ee", "#60a5fa", "#a78bfa", "#34d399", "#f472b6"]
const pointColours = ["#fb923c", "#e879f9", "#facc15", "#2dd4bf", "#fb7185", "#818cf8"]

function boundsFor(document: LandXmlDocument, pointLayers: SurveyPointLayer[]) {
  let minE = Number.POSITIVE_INFINITY
  let maxE = Number.NEGATIVE_INFINITY
  let minN = Number.POSITIVE_INFINITY
  let maxN = Number.NEGATIVE_INFINITY
  let count = 0

  function include(point: { easting: number; northing: number }) {
    minE = Math.min(minE, point.easting)
    maxE = Math.max(maxE, point.easting)
    minN = Math.min(minN, point.northing)
    maxN = Math.max(maxN, point.northing)
    count += 1
  }

  document.surfaces.forEach((surface) => Object.values(surface.points).forEach(include))
  document.alignments.forEach((alignment) => alignment.points.forEach(include))
  pointLayers.forEach((layer) => layer.points.forEach(include))

  return count ? { minE, maxE, minN, maxN } : null
}

function projection(bounds: NonNullable<ReturnType<typeof boundsFor>>) {
  const rangeE = Math.max(bounds.maxE - bounds.minE, 1)
  const rangeN = Math.max(bounds.maxN - bounds.minN, 1)
  const scale = Math.min((width - padding * 2) / rangeE, (height - padding * 2) / rangeN)
  const renderedWidth = rangeE * scale
  const renderedHeight = rangeN * scale
  const offsetX = (width - renderedWidth) / 2
  const offsetY = (height - renderedHeight) / 2

  return {
    project(point: { easting: number; northing: number }): XY {
      return {
        x: offsetX + (point.easting - bounds.minE) * scale,
        y: offsetY + (bounds.maxN - point.northing) * scale,
      }
    },
    unproject(point: XY): PlanPoint {
      return {
        easting: bounds.minE + (point.x - offsetX) / scale,
        northing: bounds.maxN - (point.y - offsetY) / scale,
        elevation: null,
      }
    },
  }
}

function formatChainage(value: number | null) {
  if (value === null) return "—"
  const kilometres = Math.floor(value / 1000)
  return `${kilometres}+${(value - kilometres * 1000).toFixed(3).padStart(7, "0")}`
}

export default function LandXmlCrossSection({ document, pointLayers, settings, onSettingsChange, onAddPointFiles }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ pointerId: number; start: PlanPoint } | null>(null)
  const [localSettings,setLocalSettings]=useState<SectionSettings>(()=>initialSectionSettings(document))
  const current=settings??localSettings
  const {alignmentName,topSurfaceName,bottomSurfaceName,referenceSurfaceName,corridor,line}=current
  const asbuiltLayerName=current.asbuiltLayerName??allSectionPointFiles
  const activePointLayers=useMemo(()=>sectionPointLayers(pointLayers,asbuiltLayerName),[pointLayers,asbuiltLayerName])
  const update=(change:Partial<SectionSettings>)=>{const next={...current,...change};if(onSettingsChange)onSettingsChange(next);else setLocalSettings(next)}
  const setAlignmentName=(value:string)=>update({alignmentName:value,sectionStart:undefined,sectionEnd:undefined})
  const setTopSurfaceName=(value:string)=>update({topSurfaceName:value,referenceSurfaceName:referenceSurfaceName===topSurfaceName?value:referenceSurfaceName,bottomSurfaceName:bottomSurfaceName===value?"":bottomSurfaceName})
  const setBottomSurfaceName=(value:string)=>update({bottomSurfaceName:value})
  const setReferenceSurfaceName=(value:string)=>update({referenceSurfaceName:value})
  const setCorridor=(value:number)=>update({corridor:value})
  const setLine=(value:SectionLine|null)=>update({line:value})
  const linearScale=metresPerLinearUnit(document.units)
  const unitLabel=sectionUnitLabel(document.units)
  const shownSurfaceIndexes=useMemo(()=>document.surfaces.flatMap((surface,index)=>[topSurfaceName,bottomSurfaceName,referenceSurfaceName].includes(surface.name)?[index]:[]),[document.surfaces,topSurfaceName,bottomSurfaceName,referenceSurfaceName])
  const [isDrawing, setIsDrawing] = useState(false)
  const [showResult, setShowResult] = useState(Boolean(settings?.line))
  useEffect(()=>{if(settings?.line&&!isDrawing)setShowResult(true)},[settings?.line,isDrawing])

  const selectedAlignment = useMemo(() => { const source = document.alignments.find((item) => item.name === alignmentName); if (!source) return undefined; try { return horizontalAlignment(source).preview() } catch { return source } }, [document.alignments, alignmentName])
  const visibleDocument=useMemo(()=>({...document,cogoPoints:[],surfaces:shownSurfaceIndexes.map((index)=>document.surfaces[index]),alignments:selectedAlignment?[selectedAlignment]:[]}),[document,shownSurfaceIndexes,selectedAlignment])
  const bounds = useMemo(() => boundsFor(visibleDocument, activePointLayers), [visibleDocument, activePointLayers])
  const mapProjection = useMemo(() => (bounds ? projection(bounds) : null), [bounds])
  const analyseSection = useMemo(() => createSectionAnalysis(document, activePointLayers, referenceSurfaceName), [document, activePointLayers, referenceSurfaceName])
  const alignment = selectedAlignment
  const alignmentRange=useMemo(()=>alignment?alignmentSectionRange(alignment):null,[alignment])
  const interval=current.sectionInterval??10, halfWidth=current.sectionHalfWidth??20
  const firstGridStation=alignmentRange?Math.ceil((alignmentRange.start-1e-8)/interval)*interval:0
  const defaultStart=alignmentRange?(firstGridStation<=alignmentRange.end?firstGridStation:alignmentRange.start):0
  const startStation=current.sectionStart??defaultStart
  const endStation=current.sectionEnd??(alignmentRange?Math.max(defaultStart,Math.floor((alignmentRange.end+1e-8)/interval)*interval):0)
  const [batch,setBatch]=useState<SectionAnalysis[]>([])
  const [batchBusy,setBatchBusy]=useState(false),[batchProgress,setBatchProgress]=useState(0),[batchError,setBatchError]=useState("")
  const batchRun=useRef(0)
  useEffect(()=>{batchRun.current++;setBatch([]);setBatchBusy(false);setBatchError("")},[analyseSection,alignment,interval,halfWidth,startStation,endStation,corridor,topSurfaceName,bottomSurfaceName])
  useEffect(()=>()=>{batchRun.current++},[])
  const batchLines=useMemo(()=>batch.map((section)=>section.line),[batch])
  async function generateSections() {
    if(!alignment)return
    const run=++batchRun.current
    setBatchBusy(true);setBatchProgress(0);setBatchError("");setBatch([])
    try{
      if(linearScale===null)throw new Error("The XML must declare supported linear units before generating interval sections.")
      const lines=createAlignmentSections(alignment,interval,halfWidth,startStation,endStation)
      const sections:SectionAnalysis[]=[]
      let pointCount=0
      for(let index=0;index<lines.length;index++){
        if(run!==batchRun.current)return
        const item=lines[index],section=analyseSection(item.line,corridor,alignment)
        section.station={chainage:item.chainage,offset:0,distance:0,sectionDistance:halfWidth}
        pointCount+=section.sectionPoints.length
        if(pointCount>500000)throw new Error("This batch contains too many point appearances. Narrow the chainage range or point search distance, or choose fewer measured files.")
        sections.push(section);setBatchProgress(Math.round((index+1)/lines.length*100))
        await new Promise<void>((resolve)=>window.setTimeout(resolve,0))
      }
      if(run===batchRun.current)setBatch(sections)
    }catch(error){if(run===batchRun.current)setBatchError(error instanceof Error?error.message:"Sections could not be generated.")}
    finally{if(run===batchRun.current)setBatchBusy(false)}
  }

  const updateRef=useRef(update);updateRef.current=update
  useEffect(()=>{
    const next=reconcileSectionSettings({alignmentName,topSurfaceName,bottomSurfaceName,referenceSurfaceName,asbuiltLayerName,corridor,line},document,pointLayers)
    if(next.alignmentName!==alignmentName||next.topSurfaceName!==topSurfaceName||next.bottomSurfaceName!==bottomSurfaceName||next.referenceSurfaceName!==referenceSurfaceName||next.asbuiltLayerName!==asbuiltLayerName)updateRef.current(next)
  },[document,pointLayers,alignmentName,topSurfaceName,bottomSurfaceName,referenceSurfaceName,asbuiltLayerName,corridor,line])

  const result = useMemo(() => {
    if (!line || isDrawing) return null
    return batch.find((section)=>section.line===line)??analyseSection(line, corridor, alignment)
  }, [alignment, corridor, isDrawing, line, analyseSection,batch])

  const bookSettings=useMemo<Omit<SectionBook,"sections"|"interval">>(()=>({document,surfaceIndices:shownSurfaceIndexes,pointFiles:activePointLayers.map((layer)=>layer.name),unitLabel,alignment:alignmentName,corridor,top:topSurfaceName,bottom:bottomSurfaceName,reference:referenceSurfaceName,crs:current.mapCrs??declaredEpsgCode(document.coordinateSystem)??document.coordinateSystem?.name??""}),[document,shownSurfaceIndexes,activePointLayers,unitLabel,alignmentName,corridor,topSurfaceName,bottomSurfaceName,referenceSurfaceName,current.mapCrs])
  const batchBook=useMemo<SectionBook|null>(()=>batch.length?{...bookSettings,sections:batch,interval}:null,[bookSettings,batch,interval])
  const singleBook=useMemo<SectionBook|null>(()=>result?{...bookSettings,sections:[result]}:null,[bookSettings,result])

  const thickness = useMemo(() => {
    if (!result) return null
    return calculateSectionThickness(
      result.samples,
      document.surfaces.findIndex((surface) => surface.name === topSurfaceName),
      document.surfaces.findIndex((surface) => surface.name === bottomSurfaceName),
      linearScale,
    )
  }, [bottomSurfaceName, document.surfaces, result, topSurfaceName, linearScale])

  const report=useMemo<SurveyReport|null>(()=>result?{
    title:"Cross-section Report",project:document.projectName,createdAt:new Date().toISOString(),
    metadata:[["LandXML file",document.fileName],["Selected as-built files",activePointLayers.map((layer)=>layer.name).join("; ")||"None"],["Alignment",alignmentName],["Design reference for level differences",referenceSurfaceName||"None"],["Top / bottom surfaces",`${topSurfaceName} / ${bottomSurfaceName||"None — thickness off"}`],["File linear units",document.units],[`Section length (${unitLabel})`,result.length],[`Point search distance each side (${unitLabel})`,corridor],[`Chainage (${unitLabel})`,result.station?.chainage??null],["Section start E/N",line?`${line.start.easting}, ${line.start.northing}`:""],["Section end E/N",line?`${line.end.easting}, ${line.end.northing}`:""]],
    summary:[["Measured points within search distance",result.sectionPoints.length],["Thickness check",bottomSurfaceName?"Enabled":"Off — no bottom surface selected"],["Thickness samples",thickness?.sampleCount??null],["Minimum thickness (mm)",thickness?.minimum??null],["Maximum thickness (mm)",thickness?.maximum??null],["Mean thickness (mm)",thickness?.average??null]],
    columns:["Type","Surface / layer","Point",`Distance (${unitLabel})`,`Offset (${unitLabel})`,`RL (${unitLabel})`,`Design RL (${unitLabel})`,"Difference (mm)"],
    rows:[...result.samples.flatMap((sample)=>shownSurfaceIndexes.map((index)=>["TIN sample",document.surfaces[index].name,"",sample.distance,null,sample.values[index],null,null])),...result.sectionPoints.map((point)=>["Measured point",point.layerName,point.id,point.distance,point.offset,point.elevation,point.referenceLevel,point.differenceMm])],
    notes:["Selected surface values are sampled along the drawn section. Only the selected as-built point files are included. Points within the search distance are projected onto the section for display; their RLs are unchanged. Level differences use the design RL at each measured point's original X/Y. Blank design levels are unassessed.","Inputs must share horizontal coordinates, file linear units and a vertical datum. Thickness and level differences use mm where units are recognised.",...document.warnings,...activePointLayers.flatMap((layer)=>layer.warnings)],
  }:null,[result,document,activePointLayers,alignmentName,referenceSurfaceName,topSurfaceName,bottomSurfaceName,corridor,line,thickness,unitLabel,shownSurfaceIndexes])

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>) {
    if (!svgRef.current || !mapProjection) return null
    const rect = svgRef.current.getBoundingClientRect()
    return mapProjection.unproject({
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    })
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    const point = pointFromEvent(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, start: point }
    setIsDrawing(true)
    setLine({ start: point, end: point })
    setShowResult(false)
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = pointFromEvent(event)
    if (point) setLine({ start: drag.start, end: point })
  }

  function finishPointer(event: ReactPointerEvent<SVGSVGElement>, cancelled = false) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const finalLine = { start: drag.start, end: pointFromEvent(event) ?? drag.start }
    const length = Math.hypot(finalLine.end.easting - finalLine.start.easting, finalLine.end.northing - finalLine.start.northing)
    dragRef.current = null
    setIsDrawing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (cancelled || length <= 0.05) {
      setLine(null)
      setShowResult(false)
      return
    }
    setLine(finalLine)
    setShowResult(true)
  }

  const projectedLine = line && mapProjection ? { start: mapProjection.project(line.start), end: mapProjection.project(line.end) } : null
  const lineLength = line ? Math.hypot(line.end.easting-line.start.easting,line.end.northing-line.start.northing) : 0
  const corridorCorners = line && lineLength && mapProjection ? [-1,1].flatMap((side)=>{
    const offsetE=-(line.end.northing-line.start.northing)/lineLength*corridor*side
    const offsetN=(line.end.easting-line.start.easting)/lineLength*corridor*side
    return (side===-1?[line.start,line.end]:[line.end,line.start]).map((point)=>mapProjection.project({easting:point.easting+offsetE,northing:point.northing+offsetN}))
  }) : []

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6">
      <div className="space-y-5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">Cross-section map</p>
          <h2 className="mt-2 text-2xl font-semibold">Alignment, design and as-built sections</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Choose your FSL/design surface from the XML and the measured CSV, TXT or DXF data to plot. Add a bottom surface only when you need thickness. All files must share the same survey grid, height datum and linear units ({unitLabel}).</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <SelectControl label="Alignment" value={alignmentName} onChange={setAlignmentName} options={document.alignments.map((item) => item.name)} emptyLabel="No alignment" />
          <SelectControl label="Top / design surface (XML)" value={topSurfaceName} onChange={setTopSurfaceName} options={document.surfaces.map((item) => item.name)} />
          <SelectControl label="Bottom surface (optional)" value={bottomSurfaceName} onChange={setBottomSurfaceName} options={document.surfaces.filter((item)=>item.name!==topSurfaceName).map((item) => item.name)} emptyLabel="None — no thickness check" />
          <div className="min-w-0 text-sm text-slate-300">
            <label><span className="mb-2 block">As-built point data</span>
              <select aria-label="As-built point data" value={asbuiltLayerName} onChange={(event)=>update({asbuiltLayerName:event.target.value})} className="w-full min-w-0 rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-cyan-400">
                <option value="">None — design profile only</option>
                <option value={allSectionPointFiles}>All imported point files ({pointLayers.length})</option>
                {pointLayers.map((layer)=><option key={layer.name} value={layer.name}>{layer.name} · {layer.format} · {layer.points.length.toLocaleString()} points</option>)}
              </select>
            </label>
            {onAddPointFiles&&<button type="button" onClick={onAddPointFiles} className="mt-2 text-xs font-semibold text-cyan-300 underline">Add CSV / TXT / DXF files</button>}
          </div>
          <label className="min-w-0 text-sm text-slate-300">
            <span className="mb-2 block">Point search distance (±{unitLabel})</span>
            <input aria-label={`Point search distance (±${unitLabel})`} type="number" min="0.05" max="20" step="0.05" value={corridor} onChange={(event) => setCorridor(Math.max(0.05, Math.min(20, Number(event.target.value) || 0.05)))} className="w-full min-w-0 rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-cyan-400" />
          </label>
        </div>
        <p className="text-xs leading-5 text-slate-400">A search distance of {corridor} {unitLabel} includes measured points up to {corridor} {unitLabel} either side of a section line, between its endpoints. Points keep their measured RLs. The shaded pink band in the source-grid plan shows this area. {linearScale===null&&"The XML does not declare supported linear units; confirm its units before comparing levels."}</p>
        <details className="rounded-xl border border-white/10 p-3">
          <summary className="cursor-pointer text-sm text-cyan-200">Design reference for level differences: {referenceSurfaceName||"None"}</summary>
          <div className="mt-3 max-w-lg"><SelectControl label="Compare measured RLs against" value={referenceSurfaceName} onChange={setReferenceSurfaceName} options={document.surfaces.map((item)=>item.name)} emptyLabel="None — plot measured levels only" /></div>
          <p className="mt-2 text-xs leading-5 text-slate-400">This is the XML design surface used for measured-minus-design differences. It follows the top/design selection unless you choose another reference here.</p>
        </details>
      </div>

      <CrossSectionWorkspaceMap document={visibleDocument} pointLayers={activePointLayers} settings={current} onChange={update} onDraw={(drawn)=>{setIsDrawing(false);setLine(drawn);setShowResult(true)}} sectionLines={batchLines} fallback={<div className="relative mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
        {bounds && mapProjection ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={(event) => finishPointer(event)}
            onPointerCancel={(event) => finishPointer(event, true)}
            className={`block aspect-[1000/620] w-full select-none ${isDrawing ? "cursor-grabbing" : "cursor-crosshair"}`}
            style={{ touchAction: "none" }}
          >
            <rect width={width} height={height} fill="#020617" />
            {visibleDocument.surfaces.map((surface, shownIndex) => {
              const surfaceIndex=shownSurfaceIndexes[shownIndex]
              const faceStep = Math.max(1, Math.ceil(surface.faces.length / 3000))
              return (
                <g key={surface.name}>
                  {surface.faces.filter((_, index) => index % faceStep === 0).map((face, index) => {
                    const points = face.map((id) => surface.points[id]).filter((point): point is PlanPoint => point !== undefined)
                    if (points.length !== 3) return null
                    return (
                      <polygon
                        key={`${surface.name}-${index}`}
                        points={points.map((point) => { const projected = mapProjection.project(point); return `${projected.x},${projected.y}` }).join(" ")}
                        fill={surfaceColours[surfaceIndex % surfaceColours.length]}
                        fillOpacity="0.1"
                        stroke={surfaceColours[surfaceIndex % surfaceColours.length]}
                        strokeOpacity="0.4"
                        strokeWidth="0.8"
                        vectorEffect="non-scaling-stroke"
                      />
                    )
                  })}
                </g>
              )
            })}

            {visibleDocument.alignments.map((item) => (
              <polyline
                key={item.name}
                points={item.points.map((point) => { const projected = mapProjection.project(point); return `${projected.x},${projected.y}` }).join(" ")}
                fill="none"
                stroke={item.name === alignmentName ? "#fbbf24" : "#64748b"}
                strokeWidth={item.name === alignmentName ? 4 : 2}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {activePointLayers.map((layer, layerIndex) => {
              const step = Math.max(1, Math.ceil(layer.points.length / 5000))
              return (
                <g key={layer.name}>
                  {layer.points.filter((_, index) => index % step === 0).map((point) => {
                    const projected = mapProjection.project(point)
                    return <circle key={`${layer.name}-${point.id}-${projected.x}-${projected.y}`} cx={projected.x} cy={projected.y} r="3.5" fill={pointColours[layerIndex % pointColours.length]} stroke="#020617" strokeWidth="1"><title>{`${layer.name} · ${point.id} · RL ${point.elevation.toFixed(3)}`}</title></circle>
                  })}
                </g>
              )
            })}

            {batch.map((section,index)=>{const a=mapProjection.project(section.line.start),b=mapProjection.project(section.line.end);return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fbbf24" strokeWidth="1.5" strokeOpacity="0.7" vectorEffect="non-scaling-stroke" pointerEvents="none"/>})}
            {projectedLine && (
              <g pointerEvents="none">
                {corridorCorners.length===4&&<polygon points={corridorCorners.map((point)=>`${point.x},${point.y}`).join(" ")} fill="#fb7185" fillOpacity="0.12" stroke="#fb7185" strokeOpacity="0.6" strokeWidth="1" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
                <line x1={projectedLine.start.x} y1={projectedLine.start.y} x2={projectedLine.end.x} y2={projectedLine.end.y} stroke="#fb7185" strokeWidth="5" strokeDasharray="12 7" vectorEffect="non-scaling-stroke" />
                <circle cx={projectedLine.start.x} cy={projectedLine.start.y} r="7" fill="#fb7185" stroke="white" strokeWidth="2" />
                <circle cx={projectedLine.end.x} cy={projectedLine.end.y} r="7" fill="#fb7185" stroke="white" strokeWidth="2" />
              </g>
            )}
          </svg>
        ) : <div className="flex aspect-[1000/620] items-center justify-center text-slate-500">No readable geometry.</div>}
      </div>} />

      <div className="mt-6 space-y-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-5">
        <h3 className="font-semibold text-cyan-100">Sections along the selected alignment</h3>
        <p className="text-sm leading-6 text-slate-400">Generate perpendicular cross sections at regular chainages. For irregular as-built locations or no alignment, use Draw section line on the map or drag a line in the source-grid plan.</p>
        {alignmentRange?.error&&<p role="alert" className="text-sm text-amber-200">{alignmentRange.error}</p>}
        {alignmentRange?<p className="text-xs text-slate-400">{alignmentName} · chainage {alignmentRange.start.toFixed(3)}–{alignmentRange.end.toFixed(3)} {unitLabel}. Width is measured each side of the alignment. Up to {maximumBatchSections} sections per batch.</p>:<p className="text-sm text-amber-200">Select an alignment to generate interval sections. A drawn section works without one.</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BatchNumber label={`Section interval (${unitLabel})`} value={interval} min={0.1} onChange={(value)=>update({sectionInterval:value})}/>
          <BatchNumber label={`Width each side (${unitLabel})`} value={halfWidth} min={0.1} onChange={(value)=>update({sectionHalfWidth:value})}/>
          <BatchNumber label={`Start chainage (${unitLabel})`} value={startStation} onChange={(value)=>update({sectionStart:value})}/>
          <BatchNumber label={`End chainage (${unitLabel})`} value={endStation} onChange={(value)=>update({sectionEnd:value})}/>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!alignment||Boolean(alignmentRange?.error)||linearScale===null||batchBusy} onClick={()=>void generateSections()} className="rounded-full bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-40">{batchBusy?`Generating… ${batchProgress}%`:"Generate alignment sections"}</button>
          {batchBusy&&<button type="button" onClick={()=>{batchRun.current++;setBatchBusy(false)}} className="text-sm text-amber-200 underline">Cancel generation</button>}
          <SectionBookDownloads book={batchBook}/>
        </div>
        {batchError&&<p role="alert" className="text-sm text-amber-200">{batchError}</p>}
        {batch.length>0&&<div className="max-h-72 overflow-auto rounded-xl border border-white/10"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-900 text-xs text-slate-400"><tr><th className="p-3">Chainage</th><th className="p-3">Measured points</th><th className="p-3">Design samples</th><th className="p-3">Section</th></tr></thead><tbody className="divide-y divide-white/10">{batch.map((section,index)=><tr key={index}><td className="p-3">{formatChainage(section.station?.chainage??null)}</td><td className="p-3">{section.sectionPoints.length}</td><td className="p-3">{section.samples.filter((sample)=>sample.values[document.surfaces.findIndex((s)=>s.name===topSurfaceName)]!==null).length} / {section.samples.length}</td><td className="p-3"><button type="button" onClick={()=>{setLine(section.line);setShowResult(true)}} className="font-semibold text-cyan-300 underline">View CH {formatChainage(section.station?.chainage??null)}</button></td></tr>)}</tbody></table></div>}
      </div>

      {result && !showResult && <button type="button" onClick={() => setShowResult(true)} className="mt-4 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">Open cross section</button>}

      {showResult && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowResult(false) }}>
          <div className="max-h-[92vh] w-full max-w-6xl overflow-auto rounded-3xl border border-white/15 bg-slate-950 p-6 shadow-2xl md:p-8">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">Cross section</p>
                <h3 className="mt-2 text-2xl font-semibold">{result.station?`CH ${formatChainage(result.station.chainage)}`:"Drawn section"}</h3>
                <p className="mt-2 text-sm text-slate-400">
                  Section length {result.length.toFixed(3)} {unitLabel} · Alignment offset {result.station ? `${result.station.offset.toFixed(3)} ${unitLabel}` : "—"}
                  {result.station?.sectionDistance !== null && result.station?.sectionDistance !== undefined ? ` · Alignment at section offset ${result.station.sectionDistance.toFixed(3)} ${unitLabel}` : ""}
                </p>
              </div>
              <button type="button" aria-label="Close cross section" onClick={() => setShowResult(false)} className="rounded-xl border border-white/10 p-2 text-slate-300 transition hover:bg-white/10"><X size={20} /></button>
            </div>

            <div className="mt-5 flex flex-wrap items-start gap-3"><SectionBookDownloads book={singleBook} single/><ReportDownloads report={report} formats={["xlsx","csv"]}/></div>
            <div className={`mt-6 grid gap-5 ${bottomSurfaceName?"xl:grid-cols-2":""}`}>
              {bottomSurfaceName&&<ThicknessSummary stats={thickness} topSurfaceName={topSurfaceName} bottomSurfaceName={bottomSurfaceName} />}
              {activePointLayers.length?<AsbuiltSummary points={result.sectionPoints} referenceSurfaceName={referenceSurfaceName} corridor={corridor} unitLabel={unitLabel} />:<p className="rounded-2xl border border-white/10 p-5 text-sm text-slate-400">No as-built point file selected. Showing the design profile only.</p>}
            </div>

            <ProfileChart surfaces={shownSurfaceIndexes.map((index)=>document.surfaces[index])} surfaceColourIndices={shownSurfaceIndexes} samples={result.samples.map((sample)=>({...sample,values:shownSurfaceIndexes.map((index)=>sample.values[index])}))} length={result.length} points={result.sectionPoints} pointLayers={activePointLayers} unitLabel={unitLabel} />
            {activePointLayers.length>0&&<AsbuiltTable points={result.sectionPoints} unitLabel={unitLabel} />}
          </div>
        </div>
      )}
    </section>
  )
}

function BatchNumber({label,value,min,onChange}:{label:string;value:number;min?:number;onChange:(value:number)=>void}) {
  return <label className="min-w-0 text-xs text-slate-300">{label}<input aria-label={label} type="number" step="any" min={min} value={value} onChange={(event)=>{const next=Number(event.target.value);if(Number.isFinite(next))onChange(min===undefined?next:Math.max(min,next))}} className="mt-2 w-full min-w-0 rounded-xl border border-white/15 bg-slate-950 px-3 py-2.5 text-sm text-white"/></label>
}

function SelectControl({ label, value, onChange, options, emptyLabel }: { label: string; value: string; onChange: (value: string) => void; options: string[]; emptyLabel?: string }) {
  return (
    <label className="min-w-0 text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="w-full min-w-0 rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-cyan-400">
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )
}

function ThicknessSummary({ stats, topSurfaceName, bottomSurfaceName }: { stats: ThicknessStats | null; topSurfaceName: string; bottomSurfaceName: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h4 className="font-semibold">Layer thickness</h4>
      <p className="mt-1 text-sm text-slate-400">{topSurfaceName || "Top surface"} minus {bottomSurfaceName || "bottom surface"}</p>
      {stats ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Minimum" value={`${stats.minimum.toFixed(0)} mm`} />
          <StatCard label="Average" value={`${stats.average.toFixed(0)} mm`} />
          <StatCard label="Maximum" value={`${stats.maximum.toFixed(0)} mm`} />
        </div>
      ) : <p className="mt-4 text-sm text-amber-200">The selected surfaces do not overlap along this section.</p>}
    </section>
  )
}

function AsbuiltSummary({ points, referenceSurfaceName, corridor, unitLabel }: { points: SectionSurveyPoint[]; referenceSurfaceName: string; corridor: number; unitLabel: string }) {
  const differences = points.map((point) => point.differenceMm).filter((value): value is number => value !== null)
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  let total = 0
  differences.forEach((value) => { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); total += value })

  return (
    <section className="rounded-2xl border border-violet-400/20 bg-violet-400/5 p-5">
      <h4 className="font-semibold">As-built comparison</h4>
      <p className="mt-1 text-sm text-slate-400">Points within ±{corridor.toFixed(2)} {unitLabel} · design reference {referenceSurfaceName || "not selected"}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Points" value={points.length.toLocaleString("en-NZ")} />
        <StatCard label="Minimum Δ" value={differences.length ? `${minimum.toFixed(0)} mm` : "—"} />
        <StatCard label="Average Δ" value={differences.length ? `${(total / differences.length).toFixed(0)} mm` : "—"} />
        <StatCard label="Maximum Δ" value={differences.length ? `${maximum.toFixed(0)} mm` : "—"} />
      </div>
    </section>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  )
}

function ProfileChart({ surfaces, surfaceColourIndices, samples, length, points, pointLayers, unitLabel }: { surfaces: LandXmlSurface[]; surfaceColourIndices: number[]; samples: Sample[]; length: number; points: SectionSurveyPoint[]; pointLayers: SurveyPointLayer[]; unitLabel: string }) {
  const levels: number[] = []
  samples.forEach((sample) => sample.values.forEach((value) => { if (value !== null) levels.push(value) }))
  points.forEach((point) => levels.push(point.elevation))
  if (!levels.length) return <p className="mt-8 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-amber-200">The section line does not cross readable surfaces or measured points.</p>

  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  levels.forEach((level) => { minimum = Math.min(minimum, level); maximum = Math.max(maximum, level) })
  const range = Math.max(maximum - minimum, 0.1)
  const chartWidth = 1000
  const chartHeight = 460
  const inset = 60
  const xAt = (distance: number) => inset + (distance / Math.max(length, 0.001)) * (chartWidth - inset * 2)
  const yAt = (level: number) => inset + ((maximum - level) / range) * (chartHeight - inset * 2)

  return (
    <div className="mt-7">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full rounded-2xl border border-white/10 bg-slate-900/60">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = inset + ratio * (chartHeight - inset * 2)
          const level = maximum - ratio * range
          return <g key={ratio}><line x1={inset} y1={y} x2={chartWidth - inset} y2={y} stroke="#334155" /><text x={8} y={y + 4} fill="#94a3b8" fontSize="12">{level.toFixed(3)}</text></g>
        })}

        {surfaces.map((surface, surfaceIndex) => {
          const segments: string[] = []
          let current = ""
          samples.forEach((sample) => {
            const value = sample.values[surfaceIndex]
            if (value === null) { if (current) segments.push(current); current = ""; return }
            current += `${current ? " L" : "M"}${xAt(sample.distance).toFixed(2)} ${yAt(value).toFixed(2)}`
          })
          if (current) segments.push(current)
          return <g key={surface.name}>{segments.map((path, index) => <path key={index} d={path} fill="none" stroke={surfaceColours[surfaceColourIndices[surfaceIndex] % surfaceColours.length]} strokeWidth="3" />)}</g>
        })}

        {points.map((point, index) => (
          <circle key={`${point.layerName}-${point.id}-${index}`} cx={xAt(point.distance)} cy={yAt(point.elevation)} r="5" fill={pointColours[point.layerIndex % pointColours.length]} stroke="white" strokeWidth="1.5">
            <title>{`${point.layerName} · ${point.id} · offset ${point.offset.toFixed(3)} ${unitLabel} · RL ${point.elevation.toFixed(3)} ${unitLabel}${point.differenceMm === null ? "" : ` · Δ ${point.differenceMm.toFixed(0)} mm`}`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-2 text-xs text-slate-400">Horizontal: distance along section ({unitLabel}) · Vertical: RL ({unitLabel})</p>

      <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-300">
        {surfaces.map((surface, index) => <Legend key={surface.name} colour={surfaceColours[surfaceColourIndices[index] % surfaceColours.length]} label={surface.name} />)}
        {pointLayers.map((layer, index) => <Legend key={layer.name} colour={pointColours[index % pointColours.length]} label={`${layer.name} (${layer.format})`} point />)}
      </div>
    </div>
  )
}

function Legend({ colour, label, point = false }: { colour: string; label: string; point?: boolean }) {
  return <span className="inline-flex items-center gap-2"><span className={point ? "h-3 w-3 rounded-full" : "h-2.5 w-6 rounded-full"} style={{ background: colour }} />{label}</span>
}

function AsbuiltTable({ points, unitLabel }: { points: SectionSurveyPoint[]; unitLabel: string }) {
  if (!points.length) return <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-400">No as-built points fall inside the selected section corridor.</p>
  return (
    <section className="mt-7 overflow-hidden rounded-2xl border border-white/10">
      <div className="flex items-center justify-between bg-white/5 px-5 py-4">
        <div><h4 className="font-semibold">Measured points in section</h4><p className="mt-1 text-xs text-slate-500">Showing {Math.min(points.length, 200).toLocaleString("en-NZ")} of {points.length.toLocaleString("en-NZ")}</p></div>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">File</th><th className="px-4 py-3">Point</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Section offset</th><th className="px-4 py-3">Corridor offset</th><th className="px-4 py-3">As-built RL</th><th className="px-4 py-3">Reference RL</th><th className="px-4 py-3">Difference</th></tr></thead>
          <tbody className="divide-y divide-white/5">
            {points.slice(0, 200).map((point, index) => (
              <tr key={`${point.layerName}-${point.id}-${index}`} className="text-slate-300">
                <td className="px-4 py-3">{point.layerName}</td><td className="px-4 py-3 font-medium text-white">{point.id}</td><td className="px-4 py-3">{point.code || "—"}</td><td className="px-4 py-3">{point.distance.toFixed(3)} {unitLabel}</td><td className="px-4 py-3">{point.offset >= 0 ? "+" : ""}{point.offset.toFixed(3)} {unitLabel}</td><td className="px-4 py-3">{point.elevation.toFixed(3)}</td><td className="px-4 py-3">{point.referenceLevel === null ? "—" : point.referenceLevel.toFixed(3)}</td><td className={`px-4 py-3 font-semibold ${point.differenceMm === null ? "text-slate-500" : Math.abs(point.differenceMm) <= 20 ? "text-emerald-300" : "text-amber-300"}`}>{point.differenceMm === null ? "—" : `${point.differenceMm >= 0 ? "+" : ""}${point.differenceMm.toFixed(0)} mm`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

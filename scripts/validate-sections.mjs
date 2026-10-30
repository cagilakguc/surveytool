import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createSectionAnalysis } from '../src/lib/sectionAnalysis.ts'
import { horizontalAlignment } from '../src/lib/alignmentGeometry.ts'
import { createAlignmentSections, alignmentSectionRange } from '../src/lib/sectionBatch.ts'
import { initialSectionSettings, reconcileSectionSettings, sectionPointLayers, allSectionPointFiles, sectionUnitLabel, calculateSectionThickness, projectPointToSection, assertSectionSettings } from '../src/lib/sectionOptions.ts'
import { createSectionBookPdf, sectionBookCsv } from '../src/lib/sectionReports.ts'
import { assertDocument } from '../src/lib/projectWorkspace.ts'
import { buildSurveyMapData, createMapTransform, mapCoordinateToSource } from '../src/lib/surveyMapGeometry.ts'
import { buildGisMapData } from '../src/lib/gisMapGeometry.ts'
const close = (a,b,t=1e-8) => assert.ok(Math.abs(a-b)<t, `${a} != ${b}`)
const p=(x,y,z=null)=>({easting:x,northing:y,elevation:z})
const E=400000,N=800000
const z=(x,y)=>100+x*0.02+y*0.01
const plane=(name,dz=0)=>({name,points:Object.fromEntries([[0,0],[40,0],[40,100],[0,100]].map(([x,y],i)=>[String(i),p(E+x,N+y,z(x,y)+dz)])),faces:[['0','1','2'],['0','2','3']],minElevation:100+dz,maxElevation:101.8+dz})
const alignment={name:'Test centreline',startStation:100,length:80,points:[p(E+20,N+10),p(E+20,N+90)],horizontalGeometry:[{type:'line',start:p(E+20,N+10),end:p(E+20,N+90),attributes:{}}]}
const doc={fileName:'synthetic.xml',version:'1.2',projectName:'Synthetic section QA',applicationName:'Tests',units:'meter',coordinateSystem:{epsgCode:'2105'},surfaces:[plane('FSL'),plane('Bottom',-0.1)],alignments:[alignment],cogoPoints:[],warnings:[]}
const measured=Array.from({length:9},(_,i)=>[5,20,35].map((x,j)=>({id:`P${i}-${j}`,code:'ASB',...p(E+x,N+10+i*10,z(x,10+i*10)+[.005,-.012,.015][j])}))).flat()
const layers=[{name:'asbuilt.csv',format:'CSV',warnings:[],points:measured},{name:'more.txt',format:'TXT',warnings:[],points:[{id:'TXT',code:'T',...p(E+15,N+40.4,z(15,40.4)+.02)}]}]
const original=structuredClone({doc,layers})
const settings=initialSectionSettings(doc)
assert.equal(settings.bottomSurfaceName,'')
assert.equal(reconcileSectionSettings(settings,doc,layers).bottomSurfaceName,'')
assert.equal(reconcileSectionSettings({...settings,bottomSurfaceName:'FSL'},doc,layers).bottomSurfaceName,'')
assert.equal(reconcileSectionSettings({...settings,bottomSurfaceName:'Bottom'},doc,layers).bottomSurfaceName,'Bottom')
assert.equal(sectionPointLayers(layers).length,2)
assert.equal(sectionPointLayers(layers,'more.txt')[0].points.length,1)
assert.equal(sectionPointLayers(layers,'').length,0)
assert.equal(reconcileSectionSettings({...settings,asbuiltLayerName:'removed.csv'},doc,layers).asbuiltLayerName,'')
assert.equal(reconcileSectionSettings({...settings,asbuiltLayerName:undefined},doc,layers).asbuiltLayerName,allSectionPointFiles)
for(const [unit,label] of [['meter','m'],['foot','ft'],['USSurveyFoot','US survey ft'],['millimeter','mm'],['Unknown','file units']]) assert.equal(sectionUnitLabel(unit),label)
const sections=createAlignmentSections(alignment,10,20,100,180)
assert.equal(sections.length,9)
close(sections[3].chainage,130)
close(sections[3].line.start.easting,E)
close(sections[3].line.start.northing,N+40)
close(sections[3].line.end.easting,E+40)
assert.equal(createAlignmentSections(alignment,5,20,100,180).length,17)
for(const args of [[0,20,100,180],[10,0,100,180],[10,20,99,180],[10,20,100,181],[10,20,180,100],[.01,20,100,180]]) assert.throws(()=>createAlignmentSections(alignment,...args))
const analyse=createSectionAnalysis(doc,layers,'FSL')
const result=analyse(sections[3].line,1,alignment)
assert.equal(result.sectionPoints.length,4)
close(result.station.chainage,130)
close(result.station.sectionDistance,20)
for(const s of result.samples) close(s.values[0],z(s.distance,40))
for(const pt of result.sectionPoints) close(pt.referenceLevel,z(pt.easting-E,pt.northing-N))
close(result.sectionPoints.find(v=>v.id==='TXT').differenceMm,20)
const thick=calculateSectionThickness(result.samples,0,1,1)
close(thick.average,100,1e-7)
assert.equal(calculateSectionThickness(result.samples,0,-1,1),null)
assert.equal(calculateSectionThickness(result.samples,0,0,1),null)
assert.equal(calculateSectionThickness(result.samples,0,1,null),null)
close(calculateSectionThickness([{distance:0,values:[10,9]}],0,1,.3048).average,304.8)
assert.equal(createSectionAnalysis(doc,[],'FSL')(sections[0].line,1).sectionPoints.length,0)
assert.equal(createSectionAnalysis(doc,layers,'')(sections[3].line,1).sectionPoints[0].differenceMm,null)
assert.ok(analyse({start:p(E-10,N+40),end:p(E+50,N+40)},1).samples.some(s=>s.values[0]===null))
const hole=structuredClone(doc);hole.surfaces[0].faces.pop()
assert.equal(createSectionAnalysis(hole,[],'FSL')({start:p(E,N+99),end:p(E+1,N+99)},1).samples[80].values[0],null)
for(const [x,y,included] of [[5,1,true],[5,1.001,false],[-.01,0,false],[10.01,0,false],[0,0,true],[10,0,true]]) assert.equal(Boolean(projectPointToSection({...p(x,y,0),id:'p',code:''},{start:p(0,0),end:p(10,0)},1)),included)
assert.equal(projectPointToSection(measured[0],{start:p(0,0),end:p(0,0)},1),null)
assert.deepEqual({doc,layers},original)
// Exact circular stations and perpendicular tangents in both directions.
for(const [rot,sign] of [['ccw',1],['cw',-1]]) {
 const a={name:rot,length:Math.PI*50,startStation:500,points:[p(100,0),p(0,sign*100)],horizontalGeometry:[{type:'curve',start:p(100,0),end:p(0,sign*100),center:p(0,0),attributes:{rot}}]}
 const h=horizontalAlignment(a), mid=h.at(Math.PI*25)
 close(mid.easting,Math.SQRT1_2*100);close(mid.northing,sign*Math.SQRT1_2*100)
 close(h.length,Math.PI*50)
 const line=createAlignmentSections(a,10,7,500+Math.PI*25,500+Math.PI*25)[0].line
 close(Math.hypot(line.start.easting-mid.easting,line.start.northing-mid.northing),7)
 close((line.end.easting-line.start.easting)*Math.cos(mid.tangent)+(line.end.northing-line.start.northing)*Math.sin(mid.tangent),0)
 close(h.preview().pointChainages.at(-1),500+Math.PI*50)
}
// Independent power series for a 100 m entry clothoid ending at radius 200 m.
function fresnelEntry(s,L,R) { let x=0,y=0; const a=1/(2*L*R), factorial=n=>n<2?1:n*factorial(n-1);for(let k=0;k<12;k++){x+=(-1)**k*a**(2*k)*s**(4*k+1)/(factorial(2*k)*(4*k+1));y+=(-1)**k*a**(2*k+1)*s**(4*k+3)/(factorial(2*k+1)*(4*k+3))}return {x,y} }
const end=fresnelEntry(100,100,200),mid=fresnelEntry(50,100,200)
for(const [rot,sign] of [['ccw',1],['cw',-1]]) {
 const a={name:'Spiral',length:100,startStation:0,points:[p(0,0),p(end.x,sign*end.y)],horizontalGeometry:[{type:'spiral',start:p(0,0),end:p(end.x,sign*end.y),attributes:{length:'100',radiusStart:'INF',radiusEnd:'200',rot,spiType:'clothoid'}}]}
 const h=horizontalAlignment(a), m=h.at(50)
 close(m.easting,mid.x,1e-10);close(m.northing,sign*mid.y,1e-10);close(m.tangent,sign*50**2/(2*100*200),1e-12)
 const exit={...a,horizontalGeometry:[{...a.horizontalGeometry[0],start:p(end.x,sign*end.y),end:p(0,0),attributes:{...a.horizontalGeometry[0].attributes,radiusStart:'200',radiusEnd:'INF',rot:rot==='cw'?'ccw':'cw'}}]}
 const reverse=horizontalAlignment(exit).at(50)
 close(reverse.easting,mid.x,1e-9);close(reverse.northing,sign*mid.y,1e-9)
 assert.throws(()=>horizontalAlignment({...a,horizontalGeometry:[{...a.horizontalGeometry[0],attributes:{...a.horizontalGeometry[0].attributes,spiType:'cubic'}}]}),/not supported/)
}
assert.throws(()=>horizontalAlignment({...alignment,hasStationEquations:true}),/station equations/)
assert.throws(()=>horizontalAlignment({...alignment,length:1000}),/length disagrees/)
assert.ok(alignmentSectionRange({...alignment,hasStationEquations:true}).error)
// Real upload worker: ccw must remain the short NE quarter circle, not a 270° clockwise arc.
const worker={self:{postMessage(){}},TextDecoder};vm.runInNewContext(fs.readFileSync('src/workers/landxmlParser.worker.js','utf8'),worker)
const xml=`<LandXML version="1.2"><Alignments><Alignment name="CCW" length="${Math.PI*50}" staStart="0"><CoordGeom><Curve rot="ccw"><Start>0 100</Start><Center>0 0</Center><End>100 0</End></Curve></CoordGeom></Alignment></Alignments></LandXML>`
const parsed=worker.parseLandXmlText(xml,'curve.xml')
assert.ok(parsed.alignments[0].points.every(v=>v.easting>=-1e-10&&v.northing>=-1e-10))
close(horizontalAlignment(parsed.alignments[0]).length,Math.PI*50)
assertDocument(JSON.parse(JSON.stringify(doc)))
assertSectionSettings({...settings,mapCrs:'EPSG:2105',mapBasemap:'aerial',sectionInterval:10,sectionHalfWidth:20,sectionStart:100,sectionEnd:180})
for(const bad of [{mapOpacity:101},{sectionInterval:0},{sectionEnd:NaN},{mapBasemap:'invalid'},{line:{}},{mapCrs:123}]) assert.throws(()=>assertSectionSettings({...settings,...bad}))
const catalogue=JSON.parse(fs.readFileSync('public/data/coordinate-systems.json','utf8'))
for(const code of ['EPSG:2105','EPSG:2193','EPSG:2263']) {
 const crs=catalogue.find(c=>c.code===code), xy=code==='EPSG:2105'?[E,N]:code==='EPSG:2193'?[1755000,5923000]:[1000000,200000]
 const out=mapCoordinateToSource(crs,createMapTransform(crs)(...xy));close(out.easting,xy[0],1e-5);close(out.northing,xy[1],1e-5)
}
const crs=catalogue.find(c=>c.code==='EPSG:2105')
assert.ok(buildSurveyMapData(crs,doc).groups.some(g=>g.id==='alignments'))
const geometry={name:'Selected points',format:'CSV',points:layers.flatMap(l=>l.points.map(p=>({...p,code:l.name}))),pointColours:{'asbuilt.csv':'#fb923c','more.txt':'#2dd4bf'},lines:[],polygons:[],warnings:[]}
const map=buildGisMapData(crs,geometry)
assert.ok(map.groups.some(g=>g.label.includes('more.txt')))
assert.equal(map.features.length,28)
const large=buildGisMapData(crs,{...geometry,points:Array.from({length:60000},(_,i)=>({...measured[i%27],id:String(i),code:i<50000?'asbuilt.csv':'more.txt'}))})
assert.ok(large.features.length<=5000)
assert.ok(large.features.some(f=>String(f.get('name')).includes('more.txt')))
const tinyFile=buildGisMapData(crs,{...geometry,points:[...Array.from({length:60001},(_,i)=>({...measured[i%27],code:'asbuilt.csv'})),{...measured[0],id:'Tiny',code:'more.txt'}]})
assert.ok(tinyFile.features.some(f=>String(f.get('name')).includes('Tiny')))
assert.equal(analyse({start:p(E,N+5),end:p(E+5,N+5)},1,alignment).station.sectionDistance,null)
const book={document:doc,sections:sections.map(s=>({...analyse(s.line,1,alignment),station:{chainage:s.chainage,sectionDistance:20,offset:0,distance:0}})),surfaceIndices:[0,1],pointFiles:layers.map(l=>l.name),unitLabel:'m',alignment:alignment.name,corridor:1,interval:10,top:'FSL',bottom:'Bottom',reference:'FSL',crs:'EPSG:2105'}
const csv=sectionBookCsv(book)
assert.match(csv,/TXT/);assert.match(csv,/Difference \(mm\)/)
assert.equal(csv.match(/Measured point,/g).length,28)
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>{const b=fs.readFileSync('public/fonts/survey-report.ttf');return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}})
try {const pdf=await createSectionBookPdf(book);assert.equal(Buffer.from(pdf).subarray(0,5).toString(),'%PDF-');fs.writeFileSync('/tmp/cross-sections-validation.pdf',new Uint8Array(pdf));fs.writeFileSync('/tmp/cross-sections-validation.csv',csv)}finally{globalThis.fetch=originalFetch}
console.log('Cross sections passed: selected files/optional bottom, analytical TIN levels, original XY, holes, source immutability, m/ft, exact arcs and clothoids, chainage limits, XML worker direction, map round trips/sampling, saved settings, full CSV and graphical PDF.')

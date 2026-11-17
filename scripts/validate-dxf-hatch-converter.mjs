import assert from "node:assert/strict"
import { convertDxfHatches } from "../src/lib/dxfHatchConverter.ts"

function dxf(tags) {
  return tags.flatMap(([code, value]) => [String(code), String(value)]).join("\r\n") + "\r\n"
}

const source = dxf([
  [0,"SECTION"],[2,"HEADER"],[9,"$ACADVER"],[1,"AC1032"],[9,"$HANDSEED"],[5,"FF"],[0,"ENDSEC"],
  [0,"SECTION"],[2,"BLOCKS"],[0,"BLOCK"],[5,"10"],[8,"0"],[2,"ROAD_ARROW"],[70,"0"],[10,"0"],[20,"0"],
  [0,"HATCH"],[5,"11"],[330,"10"],[8,"ROAD_ARROWS"],[62,"2"],[10,"0"],[20,"0"],[30,"0"],[70,"1"],[91,"1"],
  [92,"2"],[72,"0"],[73,"1"],[93,"5"],
  [10,"0"],[20,"0"],[10,"2"],[20,"0"],[10,"2"],[20,"1"],[10,"3"],[20,"1"],[10,"1"],[20,"3"],
  [75,"0"],[76,"1"],[98,"0"],
  [0,"ENDBLK"],[5,"12"],[8,"0"],[0,"ENDSEC"],
  [0,"SECTION"],[2,"ENTITIES"],
  [0,"INSERT"],[5,"13"],[8,"ARROW_LOCATIONS"],[2,"ROAD_ARROW"],[10,"410000.123"],[20,"795000.456"],
  [0,"SOLID"],[5,"14"],[8,"PAINT"],[10,"410000"],[20,"795000"],[11,"410001"],[21,"795000"],
  [12,"410000"],[22,"795001"],[13,"410001"],[23,"795001"],
  [0,"HATCH"],[5,"15"],[8,"ISLAND"],[70,"0"],[53,"45"],[91,"1"],[92,"1"],[93,"4"],
  [72,"1"],[10,"0"],[20,"0"],[11,"5"],[21,"0"],
  [72,"1"],[10,"5"],[20,"0"],[11,"5"],[21,"5"],
  [72,"1"],[10,"5"],[20,"5"],[11,"0"],[21,"5"],
  [72,"1"],[10,"0"],[20,"5"],[11,"0"],[21,"0"],
  [75,"0"],[76,"1"],[98,"0"],
  [0,"ENDSEC"],[0,"EOF"],
])
const full = convertDxfHatches(source, {mode:"full",spacing:0.25,convertSolids:true})
assert.equal(full.hatches, 2, "hatches in blocks and model space")
assert.equal(full.solids, 1, "solid marking converted")
assert.equal(full.blocksUpdated, 1, "arrow block converted")
assert(full.generatedOutlines >= 3)
assert(full.generatedLines > 0)
assert(!full.dxf.includes("0\r\nHATCH"), "no remaining hatch")
assert(!full.dxf.includes("0\r\nSOLID"), "no remaining filled solid")
assert(full.dxf.includes("2\r\nROAD_ARROW"), "block preserved")
assert(full.dxf.includes("0\r\nINSERT"), "arrow insertion preserved")
assert(full.dxf.includes("410000.123"), "global coordinates untouched")
assert(full.dxf.includes("8\r\nROAD_ARROWS"), "layers untouched")
assert(full.dxf.includes("62\r\n2"), "colour index retained")
assert(full.dxf.includes("0\r\nLWPOLYLINE"), "selectable outlines created")
assert(full.dxf.includes("0\r\nLINE"), "visible hatch fill linework created")
const light = convertDxfHatches(source, {mode:"outlines",spacing:1,convertSolids:true})
assert.equal(light.generatedLines, 0)
assert(light.generatedOutlines >= 3)
const withoutSolids = convertDxfHatches(source, {mode:"full",spacing:0.5,convertSolids:false})
assert.equal(withoutSolids.solids, 0)
assert(withoutSolids.dxf.includes("0\r\nSOLID"))
assert.throws(() => convertDxfHatches("not a dxf", {mode:"full",spacing:0.25,convertSolids:true}), /Invalid|EOF/)
assert.throws(() => convertDxfHatches(source, {mode:"full",spacing:0,convertSolids:true}), /positive/)
console.log("DXF hatch and road-marking conversion: PASS")

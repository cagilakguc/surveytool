import assert from "node:assert/strict";
import { parseRawCsv, readingsToCsv, pairsToCsv } from "../src/lib/rawCsv.ts";

// 1. Basic comma file, face I only, two observations per pair averaged.
{
  const csv = [
    "setup,target,hz,vz,sd,hi,ht",
    "A,B,10.0000,100.0000,100.0000,1.500,1.500",
    "A,B,10.0010,100.0010,100.0020,1.500,1.500",
    "A,C,250.0000,101.0000,150.0000,1.500,1.500",
  ].join("\n");
  const raw = parseRawCsv(csv);
  assert.equal(raw.readings.length, 3);
  assert.equal(raw.pairs.length, 2);
  const ab = raw.pairs.find((p) => p.target === "B");
  assert.equal(ab.count, 2);
  assert.ok(Math.abs(ab.hz - 10.0005) < 1e-9, `mean hz ${ab.hz}`);
  assert.ok(Math.abs(ab.sd - 100.0010) < 1e-9, `mean sd ${ab.sd}`);
  assert.equal(raw.qc.skippedLines.length, 0);
  assert.equal(raw.qc.unpairedFaces.length, 2); // only face I present
}

// 2. Semicolon file with decimal commas (typical Turkish Excel export).
{
  const csv = [
    "Istasyon;Hedef;Hz;V;Mesafe;HI;HT",
    "A;B;10,0000;100,0000;100,0000;1,500;1,500",
  ].join("\n");
  const raw = parseRawCsv(csv);
  assert.equal(raw.readings.length, 1);
  assert.ok(Math.abs(raw.readings[0].hz - 10) < 1e-9);
  assert.ok(Math.abs(raw.readings[0].sd - 100) < 1e-9);
}

// 3. Face II observation reduces to the same face I values as its face I partner.
{
  const face1 = { hz: 42.12345, v: 97.5, sd: 85.4321 };
  const face2Hz = (face1.hz + 200) % 400;
  const face2V = 400 - face1.v;
  const csv = [
    "setup,target,face,hz,vz,sd,hi,ht",
    `A,B,1,${face1.hz},${face1.v},${face1.sd},1.5,1.5`,
    `A,B,2,${face2Hz},${face2V},${face1.sd},1.5,1.5`,
  ].join("\n");
  const raw = parseRawCsv(csv);
  assert.equal(raw.pairs.length, 1);
  assert.equal(raw.pairs[0].count, 2);
  assert.ok(Math.abs(raw.pairs[0].hz - face1.hz) < 1e-9, `hz ${raw.pairs[0].hz}`);
  assert.ok(Math.abs(raw.pairs[0].vz - face1.v) < 1e-9);
  assert.equal(raw.qc.unpairedFaces.length, 0);
}

// 4. Face derived from V when no face column is present.
{
  const csv = [
    "setup,target,hz,vz,sd,hi,ht",
    "A,B,42.12345,302.5,85.4321,1.5,1.5",
  ].join("\n");
  const raw = parseRawCsv(csv);
  assert.equal(raw.readings[0].face, 2);
  assert.ok(Math.abs(raw.readings[0].vz - 97.5) < 1e-9);
}

// 5. Missing required column is reported by name.
{
  assert.throws(
    () => parseRawCsv("setup,target,hz,vz,sd,hi\nA,B,1,100,10,1.5"),
    /missing required column\(s\): ht/,
  );
}

// 6. Bad rows are skipped with a reason; good rows are kept.
{
  const csv = [
    "setup,target,hz,vz,sd,hi,ht",
    "A,B,10,100,100,1.5,1.5",
    "A,B,abc,100,100,1.5,1.5",
    ",B,10,100,100,1.5,1.5",
    "A,B,10,100,-5,1.5,1.5",
  ].join("\n");
  const raw = parseRawCsv(csv);
  assert.equal(raw.readings.length, 1);
  assert.equal(raw.qc.skippedLines.length, 3);
  assert.equal(raw.qc.skippedLines[0].lineNumber, 3);
}

// 7. Quoted target names may contain the delimiter.
{
  const csv = [
    "setup,target,hz,vz,sd,hi,ht",
    'A,"TRAV 1, north",10,100,100,1.5,1.5',
  ].join("\n");
  const raw = parseRawCsv(csv);
  assert.equal(raw.readings[0].target, "TRAV 1, north");
}

// 8. Column aliases and aliases for instrument/target heights are matched case-insensitively.
{
  const csv = [
    "Station,Point,HZ_GON,V_GON,Distance,HI_M,HT_M,PPM",
    "A,B,10,100,100,1.5,1.6,4.2",
  ].join("\n");
  const raw = parseRawCsv(csv);
  assert.equal(raw.readings[0].ht, 1.6);
  assert.equal(raw.readings[0].ppm, 4.2);
}

// 9. Exports contain a header and one row per reading or pair.
{
  const csv = [
    "setup,target,hz,vz,sd,hi,ht",
    "A,B,10,100,100,1.5,1.5",
    "A,B,10,100,100.001,1.5,1.5",
  ].join("\n");
  const raw = parseRawCsv(csv);
  const readingLines = readingsToCsv(raw.readings).trim().split("\n");
  assert.equal(readingLines.length, 3);
  assert.ok(readingLines[0].startsWith("setup,target,face"));
  const pairLines = pairsToCsv(raw.pairs).trim().split("\n");
  assert.equal(pairLines.length, 2);
  assert.ok(pairLines[1].startsWith("A,B,2,"));
}

console.log("Raw CSV import validation passed.");

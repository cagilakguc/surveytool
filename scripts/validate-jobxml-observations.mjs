import assert from "node:assert/strict";
import { parseJobXmlObservations, parseXmlTree } from "../src/lib/jobXmlObservations.ts";

const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- test field book -->
<JOBFile jobName="TEST">
  <FieldBook>
    <UnitsRecord ID="u1" TimeStamp="2026-01-01T09:00:00"><DistanceUnits>Metres</DistanceUnits></UnitsRecord>
    <StationRecord ID="s1" TimeStamp="2026-01-01T10:00:00">
      <StationName>S1 &amp; A</StationName>
      <TheodoliteHeight>1.5</TheodoliteHeight>
    </StationRecord>
    <TargetRecord ID="t1" TimeStamp="2026-01-01T10:00:00">
      <Name>Prism</Name>
      <TargetHeight>1.6</TargetHeight>
    </TargetRecord>
    <PointRecord ID="p1" TimeStamp="2026-01-01T10:00:05">
      <Name>P1</Name>
      <Code>PEG</Code>
      <Method>DirectReading</Method>
      <Classification>Normal</Classification>
      <Deleted>false</Deleted>
      <Circle>
        <HorizontalCircle>10.5</HorizontalCircle>
        <VerticalCircle>90</VerticalCircle>
        <EDMDistance>100.123</EDMDistance>
        <Face>Face1</Face>
      </Circle>
      <StationID>s1</StationID>
      <TargetID>t1</TargetID>
      <ComputedGrid>
        <North>2000</North>
        <East>1000</East>
        <Elevation>10</Elevation>
      </ComputedGrid>
    </PointRecord>
    <PointRecord ID="p2" TimeStamp="2026-01-01T10:00:20">
      <Name>P1</Name>
      <Code>PEG</Code>
      <Method>DirectReading</Method>
      <Classification>Normal</Classification>
      <Deleted>true</Deleted>
      <Circle>
        <HorizontalCircle>210.5</HorizontalCircle>
        <VerticalCircle>89.9</VerticalCircle>
        <EDMDistance>100.124</EDMDistance>
        <Face>Face2</Face>
      </Circle>
      <StationID>s1</StationID>
      <TargetID>t1</TargetID>
      <ComputedGrid>
        <North>2000</North>
        <East>1000</East>
        <Elevation>10</Elevation>
      </ComputedGrid>
    </PointRecord>
    <PointRecord ID="p3" TimeStamp="2026-01-01T10:00:30">
      <Name>P1</Name>
      <Code>PEG</Code>
      <Method>MeanTurnedAngle</Method>
      <Classification>MTA</Classification>
      <Deleted>false</Deleted>
      <MTA>
        <HorizontalCircle>10.5</HorizontalCircle>
        <VerticalCircle>90</VerticalCircle>
        <EDMDistance>100.1235</EDMDistance>
        <NumberOfHorizontalAngles>2</NumberOfHorizontalAngles>
      </MTA>
      <StationID>s1</StationID>
      <TargetID>t1</TargetID>
      <ComputedGrid>
        <North>2000</North>
        <East>1000</East>
        <Elevation>10</Elevation>
      </ComputedGrid>
    </PointRecord>
    <PointRecord ID="p4" TimeStamp="2026-01-01T10:01:00">
      <Name>C1</Name>
      <Code></Code>
      <Method>Keyed</Method>
      <Classification>Normal</Classification>
      <Deleted>false</Deleted>
      <ComputedGrid>
        <North>3000</North>
        <East>3000</East>
        <Elevation>12</Elevation>
      </ComputedGrid>
    </PointRecord>
  </FieldBook>
</JOBFile>`;

// Generic XML reader: entities, attributes and nesting.
{
  const tree = parseXmlTree(xml);
  const job = tree.children.find((c) => c.name === "JOBFile");
  assert.equal(job.attributes.jobName, "TEST");
  const station = job.children[0].children.find((c) => c.name === "StationRecord");
  assert.equal(station.attributes.ID, "s1");
  assert.equal(station.children.find((c) => c.name === "StationName").text, "S1 & A");
}

const data = parseJobXmlObservations(xml);

// Direct readings are observations; the deleted one is kept and flagged.
assert.equal(data.observations.length, 2);
const live = data.observations.find((o) => !o.deleted);
assert.equal(live.face, "Face1");
assert.equal(live.hzDeg, 10.5);
assert.equal(live.vDeg, 90);
assert.equal(live.slopeM, 100.123);
assert.equal(live.setupName, "S1 & A", "entities are decoded");
assert.equal(live.instrumentHeightM, 1.5);
assert.equal(live.targetHeightM, 1.6);
assert.equal(live.targetE, 1000, "own computed coordinates are used");
assert.equal(live.targetN, 2000);
assert.equal(data.observations.find((o) => o.deleted).face, "Face2");

// Mean turned angles are listed separately, with their count.
assert.equal(data.means.length, 1);
assert.equal(data.means[0].count, 2);
assert.equal(data.means[0].target, "P1");

// Coordinate-only point is skipped and reported.
assert.ok(data.warnings.some((w) => w.includes("skipped")), "skipped point reported");
assert.equal(data.observations.some((o) => o.target === "C1"), false);

// The setup name has no coordinate history in this small file, so it is reported, not invented.
assert.equal(data.setups.length, 1);
assert.equal(data.setups[0].easting, null);
assert.ok(data.warnings.some((w) => w.includes("No coordinates found")));

// Not a JobXML file.
assert.throws(() => parseJobXmlObservations("<Other></Other>"), /no FieldBook/);

console.log("JobXML observation validation passed.");

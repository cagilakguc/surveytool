import assert from "node:assert/strict";
import { buildTraverseChain } from "../src/lib/traverseChain.ts";

let observationNumber = 0;

function setup(recordId, name, timestamp, occurrence = 1) {
  return {
    recordId,
    name,
    occurrence,
    label: occurrence > 1 ? `${name} (${occurrence})` : name,
    timestamp,
    easting: null,
    northing: null,
    elevation: null,
    instrumentHeightM: 1.5,
    observationCount: 0,
  };
}

/** Builds one observation; targets are listed in the order they were observed. */
function obs(recordId, setupName, timestamp, target, deleted = false) {
  observationNumber += 1;
  return {
    observationNumber,
    timestamp,
    setupRecordId: recordId,
    setupName,
    instrumentHeightM: 1.5,
    target,
    pointCode: "",
    classification: "",
    face: "Face1",
    hzDeg: 0,
    vDeg: 90,
    slopeM: 100,
    targetHeightM: 1.6,
    deleted,
    targetE: null,
    targetN: null,
    targetZ: null,
  };
}

function data(setups, observations) {
  return { observations, means: [], setups, qc: { rowCount: observations.length, deletedCount: 0, meanRowCount: 0, unknownTargetCoordinates: 0 }, warnings: [] };
}

const options = { includeDeleted: false };

// 1. Closed traverse: S1 -> S2 -> S3 -> S1, first observation at each setup is the backsight.
{
  const setups = [
    setup("r1", "S1", "2026-01-01T10:00:00"),
    setup("r2", "S2", "2026-01-01T10:30:00"),
    setup("r3", "S3", "2026-01-01T11:00:00"),
    setup("r4", "S1", "2026-01-01T11:30:00", 2),
  ];
  const observations = [
    obs("r1", "S1", "2026-01-01T10:00:10", "BS0"),
    obs("r1", "S1", "2026-01-01T10:00:20", "BS1"),
    obs("r1", "S1", "2026-01-01T10:00:30", "S2"),
    obs("r2", "S2", "2026-01-01T10:30:10", "S1"),
    obs("r2", "S2", "2026-01-01T10:30:20", "S3"),
    obs("r3", "S3", "2026-01-01T11:00:10", "S2"),
    obs("r3", "S3", "2026-01-01T11:00:20", "S1"),
    obs("r4", "S1", "2026-01-01T11:30:10", "S3"),
    obs("r4", "S1", "2026-01-01T11:30:20", "BS0"),
  ];
  const chain = buildTraverseChain(data(setups, observations), options);
  assert.deepEqual(chain.stations.map((s) => s.name), ["S1", "S2", "S3", "S1"]);
  assert.deepEqual(chain.stations.map((s) => s.link), ["known", "chain", "chain", "chain"]);
  assert.equal(chain.closed, true);
  assert.deepEqual(chain.knownPoints, ["BS0", "BS1"]);
  assert.deepEqual(chain.warnings, []);
}

// 2. Repeated occupation: S2 set up three times is one station, not a break.
{
  const setups = [
    setup("r1", "S1", "2026-01-01T10:00:00"),
    setup("r2", "S2", "2026-01-01T10:30:00"),
    setup("r3", "S2", "2026-01-01T10:35:00", 2),
    setup("r4", "S2", "2026-01-01T10:40:00", 3),
  ];
  const observations = [
    obs("r1", "S1", "2026-01-01T10:00:10", "BS0"),
    obs("r1", "S1", "2026-01-01T10:00:20", "S2"),
    obs("r2", "S2", "2026-01-01T10:30:10", "S1"),
    obs("r3", "S2", "2026-01-01T10:35:10", "S1"),
    obs("r4", "S2", "2026-01-01T10:40:10", "S1"),
  ];
  const chain = buildTraverseChain(data(setups, observations), options);
  assert.equal(chain.stations.length, 2);
  assert.equal(chain.stations[1].occupations.length, 3);
  assert.equal(chain.stations[1].link, "chain");
  assert.equal(chain.closed, false);
  assert.deepEqual(chain.warnings, []);
}

// 3. Backsight that is not the previous station is reported as a break.
{
  const setups = [
    setup("r1", "S1", "2026-01-01T10:00:00"),
    setup("r2", "S2", "2026-01-01T10:30:00"),
  ];
  const observations = [
    obs("r1", "S1", "2026-01-01T10:00:10", "BS0"),
    obs("r2", "S2", "2026-01-01T10:30:10", "BS9"),
  ];
  const chain = buildTraverseChain(data(setups, observations), options);
  assert.equal(chain.stations[1].link, "break");
  assert.equal(chain.warnings.length, 1);
  assert.match(chain.warnings[0], /not the previous station/);
}

// 4. A setup without observations has no backsight and is reported.
{
  const setups = [
    setup("r1", "S1", "2026-01-01T10:00:00"),
    setup("r2", "S2", "2026-01-01T10:30:00"),
  ];
  const observations = [obs("r1", "S1", "2026-01-01T10:00:10", "BS0")];
  const chain = buildTraverseChain(data(setups, observations), options);
  assert.equal(chain.stations[1].backsight, null);
  assert.equal(chain.stations[1].link, "none");
  assert.match(chain.warnings[0], /no observations/);
}

// 5. Deleted first observation is skipped when deleted rows are excluded.
{
  const setups = [setup("r1", "S1", "2026-01-01T10:00:00")];
  const observations = [
    obs("r1", "S1", "2026-01-01T10:00:05", "OLD", true),
    obs("r1", "S1", "2026-01-01T10:00:10", "BS0"),
  ];
  const chain = buildTraverseChain(data(setups, observations), options);
  assert.equal(chain.stations[0].backsight, "BS0");
  const withDeleted = buildTraverseChain(data(setups, observations), { includeDeleted: true });
  assert.equal(withDeleted.stations[0].backsight, "OLD");
}

console.log("validate-traverse-chain: all checks passed");

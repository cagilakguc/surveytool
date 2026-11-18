export type LevellingMethod = "setups" | "distance";

export type LevelLeg = {
  to: string;
  backsight: number;
  foresight: number;
  setups: number;
  /** Horizontal levelling route length in metres; optional for setup weighting. */
  distance: number | null;
};

export type LevellingInput = {
  start: string;
  end: string;
  startElevation: number;
  endElevation: number;
  legs: LevelLeg[];
  method: LevellingMethod;
  toleranceMm?: number | null;
};

export type AdjustedLevelLeg = LevelLeg & {
  from: string;
  observedRise: number;
  correction: number;
  adjustedRise: number;
  rawElevation: number;
  adjustedElevation: number;
  cumulativeSetups: number;
  cumulativeDistance: number | null;
};

export type LevellingResult = {
  legs: AdjustedLevelLeg[];
  observedEnd: number;
  misclosure: number;
  totalSetups: number;
  totalDistance: number | null;
  withinTolerance: boolean | null;
};

export function adjustLevelling(input: LevellingInput): LevellingResult {
  const start = input.start.trim();
  const end = input.end.trim();
  if (!start || !end) throw new Error("Enter the start and end benchmark names.");
  if (!Number.isFinite(input.startElevation) || !Number.isFinite(input.endElevation))
    throw new Error("Enter valid known heights for the start and end benchmarks.");
  if (!input.legs.length) throw new Error("Add at least one levelling section.");
  if (input.method !== "setups" && input.method !== "distance")
    throw new Error("Select a closure distribution method.");
  if (input.toleranceMm != null && (!Number.isFinite(input.toleranceMm) || input.toleranceMm < 0))
    throw new Error("The optional closure tolerance must be zero or greater.");

  const visited = new Set([start.toLowerCase()]);
  let totalSetups = 0;
  let distanceSum = 0;
  let allDistances = true;
  let totalRise = 0;
  input.legs.forEach((leg, index) => {
    const to = leg.to.trim();
    if (!to) throw new Error(`Section ${index + 1}: enter the destination point.`);
    if (index === input.legs.length - 1 && to.toLowerCase() !== end.toLowerCase())
      throw new Error(`The final section must end at ${end}.`);
    if (index < input.legs.length - 1 && (to.toLowerCase() === end.toLowerCase() || visited.has(to.toLowerCase())))
      throw new Error(`Section ${index + 1}: point ${to} is repeated before the end benchmark.`);
    if (!Number.isFinite(leg.backsight) || !Number.isFinite(leg.foresight))
      throw new Error(`Section ${index + 1}: enter valid backsight and foresight readings.`);
    if (!Number.isSafeInteger(leg.setups) || leg.setups < 1)
      throw new Error(`Section ${index + 1}: setup count must be a positive whole number.`);
    if (leg.distance == null) {
      if (input.method === "distance")
        throw new Error(`Section ${index + 1}: enter a positive route distance in metres.`);
      allDistances = false;
    } else if (!Number.isFinite(leg.distance) || leg.distance <= 0) {
      throw new Error(`Section ${index + 1}: route distance must be greater than zero.`);
    } else distanceSum += leg.distance;
    totalSetups += leg.setups;
    totalRise += leg.backsight - leg.foresight;
    visited.add(to.toLowerCase());
  });
  if (!Number.isSafeInteger(totalSetups) || !Number.isFinite(totalRise))
    throw new Error("Measurements exceed the supported numeric range.");

  const observedEnd = input.startElevation + totalRise;
  const misclosure = observedEnd - input.endElevation;
  if (!Number.isFinite(misclosure)) throw new Error("Closure exceeds the supported numeric range.");
  const totalWeight = input.method === "setups" ? totalSetups : distanceSum;
  let rawElevation = input.startElevation;
  let adjustedElevation = input.startElevation;
  let cumulativeSetups = 0;
  let cumulativeDistance = 0;
  const legs = input.legs.map((leg, index) => {
    const observedRise = leg.backsight - leg.foresight;
    const weight = input.method === "setups" ? leg.setups : leg.distance!;
    const correction = -misclosure * weight / totalWeight;
    rawElevation += observedRise;
    adjustedElevation += observedRise + correction;
    cumulativeSetups += leg.setups;
    cumulativeDistance += leg.distance ?? 0;
    return {
      ...leg,
      from: index === 0 ? start : input.legs[index - 1].to.trim(),
      to: leg.to.trim(),
      observedRise,
      correction,
      adjustedRise: observedRise + correction,
      rawElevation,
      adjustedElevation,
      cumulativeSetups,
      cumulativeDistance: allDistances ? cumulativeDistance : null,
    };
  });
  return {
    legs,
    observedEnd,
    misclosure,
    totalSetups,
    totalDistance: allDistances ? distanceSum : null,
    withinTolerance: input.toleranceMm == null ? null : Math.abs(misclosure * 1000) <= input.toleranceMm + 1e-9,
  };
}

/** CSV, tab, or semicolon file: to,bs,fs,setups,distance. Header is optional. */
export function parseLevellingCsv(text: string): LevelLeg[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error("The measurement file is empty.");
  const delimiter = [",", ";", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  function cells(line: string): string[] {
    const values: string[] = [];
    let value = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) { values.push(value.trim()); value = ""; }
      else value += char;
    }
    if (quoted) throw new Error("A quoted CSV value is not closed.");
    values.push(value.trim());
    return values;
  }
  const first = cells(lines[0]);
  const hasHeader = /^(to|point|destination)$/i.test(first[0]);
  const rows = (hasHeader ? lines.slice(1) : lines).map(cells);
  if (!rows.length) throw new Error("The measurement file contains no sections.");
  if (rows.length > 5000) throw new Error("The file contains more than 5,000 sections.");
  return rows.map((row, index) => {
    if (row.length < 3 || row.length > 5) throw new Error(`CSV row ${index + 1}: expected 3 to 5 columns.`);
    const required = (value: string | undefined) => value?.trim() ? Number(value) : NaN;
    const setups = row[3]?.trim() ? Number(row[3]) : 1;
    const distance = row[4]?.trim() ? Number(row[4]) : null;
    return {
      to: row[0],
      backsight: required(row[1]),
      foresight: required(row[2]),
      setups,
      distance,
    };
  });
}

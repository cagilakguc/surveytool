/**
 * Reads raw total-station observations directly from a Trimble JobXML (.jxl) field book.
 *
 * Observations are PointRecord elements with a Circle block (direct readings) or an MTA
 * block (mean turned angles). Setup and target details come from StationRecord and
 * TargetRecord, which the points refer to by ID. Coordinates are the ComputedGrid values
 * stored with each reading, before any adjustment.
 */

import { buildObservationData } from "./observationModel";
import type { ObservationData, ObservationRecord } from "./observationModel";

export type { ObservationData } from "./observationModel";

type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(value: string) {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? "");
}

/** Minimal XML reader for JobXML: elements, attributes and text. Comments and declarations are skipped. */
export function parseXmlTree(xml: string): XmlNode {
  const root: XmlNode = { name: "#document", attributes: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/\s*([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(xml)) !== null) {
    const [, cdata, closeName, openName, attrText, selfClosing, text] = match;
    const current = stack[stack.length - 1];
    if (cdata !== undefined) {
      current.text += cdata;
    } else if (closeName !== undefined) {
      if (stack.length > 1) stack.pop();
    } else if (openName !== undefined) {
      const attributes: Record<string, string> = {};
      const attrPattern = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
      let attr: RegExpExecArray | null;
      while ((attr = attrPattern.exec(attrText ?? "")) !== null) {
        attributes[attr[1]] = decode(attr[2]);
      }
      const node: XmlNode = { name: openName, attributes, children: [], text: "" };
      current.children.push(node);
      if (selfClosing !== "/") stack.push(node);
    } else if (text !== undefined) {
      current.text += decode(text);
    }
  }
  return root;
}

const child = (node: XmlNode | undefined, name: string) => node?.children.find((c) => c.name === name);
const childText = (node: XmlNode | undefined, name: string) => (child(node, name)?.text ?? "").trim();
const numberOf = (value: string) => (value === "" ? NaN : Number(value));

export function parseJobXmlObservations(xml: string): ObservationData {
  const document = parseXmlTree(xml);
  const jobFile = child(document, "JOBFile");
  const fieldBook = child(jobFile, "FieldBook");
  if (!fieldBook) throw new Error("This JobXML file has no FieldBook section.");

  const stations = new Map<string, { name: string; height: number }>();
  const targets = new Map<string, number>();
  for (const node of fieldBook.children) {
    if (node.name === "StationRecord") {
      stations.set(node.attributes.ID ?? "", {
        name: childText(node, "StationName"),
        height: numberOf(childText(node, "TheodoliteHeight")),
      });
    } else if (node.name === "TargetRecord") {
      targets.set(node.attributes.ID ?? "", numberOf(childText(node, "TargetHeight")));
    }
  }

  const records: ObservationRecord[] = [];
  let skipped = 0;
  for (const node of fieldBook.children) {
    if (node.name !== "PointRecord") continue;

    const method = childText(node, "Method");
    const circle = child(node, "Circle") ?? child(node, "MTA");
    if (!circle) {
      // Coordinate-only points carry no observation.
      skipped++;
      continue;
    }

    const station = stations.get(childText(node, "StationID"));
    const grid = child(node, "ComputedGrid");
    const deleted = childText(node, "Deleted").toLowerCase() === "true";
    const isMean = method === "MeanTurnedAngle";

    records.push({
      observationNumber: records.length + 1,
      timestamp: node.attributes.TimeStamp ?? "",
      method,
      setupRecordId: childText(node, "StationID"),
      setupName: station?.name ?? "",
      instrumentHeightM: station?.height ?? NaN,
      target: childText(node, "Name"),
      pointCode: childText(node, "Code"),
      classification: childText(node, "Classification"),
      face: childText(circle, "Face"),
      hzDeg: numberOf(childText(circle, "HorizontalCircle")),
      vDeg: numberOf(childText(circle, "VerticalCircle")),
      slopeM: numberOf(childText(circle, "EDMDistance")),
      targetHeightM: targets.get(childText(node, "TargetID")) ?? NaN,
      deleted,
      ownE: numberOf(childText(grid, "East")),
      ownN: numberOf(childText(grid, "North")),
      ownZ: numberOf(childText(grid, "Elevation")),
      meanCount: isMean ? numberOf(childText(circle, "NumberOfHorizontalAngles")) : 0,
    });
  }

  const data = buildObservationData(records);
  if (skipped > 0) data.warnings.push(`${skipped} point record(s) without an observation were skipped.`);
  return data;
}

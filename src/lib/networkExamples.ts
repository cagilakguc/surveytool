import type { NetworkMode } from "./networkAdjustment"
import { defaultNetworkSettings, networkCsv } from "./networkInput"
import type { NetworkSettings } from "./networkInput"
export function networkExample(mode: NetworkMode) {
  const settings: NetworkSettings = { ...defaultNetworkSettings, mode, levelMmPerSqrtKm: 2, name: mode === "level" ? "Example · benchmark network" : "Example · 2D control network", grid: "Synthetic local grid" }
  if (mode === "level") return { settings,
    points: "Point,Easting,Northing,RL,Fixed\nBM1,1000,1000,100,true\nP1,1050,1020,100.45,false\nP2,1120,1060,100.8,false\nBM2,1200,1100,101,true\n",
    observations: "ID,Type,From,To,Back,Value,Sigma,Set,Length_km,Enabled\nL1,DH,BM1,P1,,0.502,,,0.25,true\nL2,DH,P1,P2,,0.297,,,0.16,true\nL3,DH,P2,BM2,,0.202,,,0.09,true\nL4,DH,BM1,P2,,0.801,,,0.36,true\nL5,DH,P1,BM2,,0.499,,,0.25,true\n" }
  const exact = { A: [1000, 1000], B: [1200, 1000], P1: [1050, 1080], P2: [1150, 1120] } as const
  const points = "Point,Easting,Northing,RL,Fixed\nA,1000,1000,,true\nB,1200,1000,,true\nP1,1050.12,1079.88,,false\nP2,1149.9,1120.15,,false\n"
  const rows: Array<Array<string | number>> = [["ID", "Type", "From", "To", "Back", "Value", "Sigma", "Set", "Length_km", "Enabled"]]
  const bearing = (a: keyof typeof exact, b: keyof typeof exact) => ((Math.atan2(exact[b][0] - exact[a][0], exact[b][1] - exact[a][1]) * 180 / Math.PI) % 360 + 360) % 360
  for (const [i, a, b, noise] of [[1, "A", "P1", .002], [2, "B", "P1", -.003], [3, "A", "P2", -.001], [4, "B", "P2", .0024], [5, "P1", "P2", -.0016]] as const) rows.push([`D${i}`, "HD", a, b, "", Math.hypot(exact[b][0] - exact[a][0], exact[b][1] - exact[a][1]) + noise, "", "", "", "true"])
  rows.push(["A1", "HA", "A", "P1", "B", (bearing("A", "P1") - bearing("A", "B") + 360) % 360 + 2.4 / 3600, 3, "", "", "true"])
  rows.push(["A2", "HA", "B", "P2", "A", (bearing("B", "P2") - bearing("B", "A") + 360) % 360 - 3.6 / 3600, 3, "", "", "true"])
  for (const [i, to, noise] of [[1, "B", -1.6], [2, "P1", 1], [3, "P2", .4]] as const) rows.push([`R${i}`, "DIR", "A", to, "", (bearing("A", to) - 15 + 360) % 360 + noise / 3600, 2, "SET1", "", "true"])
  rows.push(["B1", "AZ", "B", "P1", "", bearing("B", "P1") + 1.4 / 3600, 4, "", "", "true"])
  return { settings, points, observations: networkCsv(rows, false) }
}

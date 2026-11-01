declare module "cdt2d" {
  export default function triangulate(
    points: number[][],
    edges: number[][],
    options?: {
      delaunay?: boolean;
      interior?: boolean;
      exterior?: boolean;
      infinity?: boolean;
    },
  ): number[][];
}
declare module "robust-segment-intersect" {
  export default function intersects(
    a: number[],
    b: number[],
    c: number[],
    d: number[],
  ): boolean;
}

# SurveyTool.io

Browser-based tools for survey file conversion and civil engineering checks. Built with React, TypeScript, Vite and Tailwind, with GitHub and Vercel deployments.

## Tools

- CSV to DXF with column mapping, optional heights/codes, labels and R12-compatible layers.
- LandXML viewer with surface, alignment and point previews.
- Global street and aerial backgrounds in LandXML Viewer and Surface Compare, with searchable EPSG selection and map preferences saved per project on the current device.
- Cross-sections, surface comparison and pavement conformance.
- NZ coordinate conversion between Mount Eden 2000, NZTM2000 and NZGD2000 geographic coordinates.
- GIS export to 3D Shapefile ZIP and GeoPackage, including separate point, line and polygon layers.
- Account and project workspace, with Supabase and Stripe integration.

## Local development

```sh
npm ci
npm run dev
npm run build
npm run lint
```

Public Supabase configuration is described in `.env.example`. Billing secrets belong in the deployment environment.

## Background maps and coordinate systems

Import a LandXML file and use **Map & coordinates** to confirm its source CRS. Recognised EPSG attributes and exact grid names are read from LandXML by both parsers. Otherwise search by EPSG code, grid name and optional country/region. Each input file has its own setting. The EPSG catalogue is generated locally from `epsg-index` before development and production builds; its attribution is included in `public/data`.

Street maps use OpenFreeMap; aerial imagery uses Esri World Imagery. Both show their provider attribution. **No background**, overlay opacity, pan/zoom, **Fit to surface** and the original plan preview are available. Files stay in the browser; background requests go directly to the selected map provider. Project map preferences are saved in local storage and are not account-synchronised.

Surface comparison requires matching source grids and compatible linear units. Results use metres, square metres and cubic metres, including when both input surfaces use feet. Map reprojection is for display and does not change survey coordinates or the volume calculation. Vertical datums are retained and must be compatible. Local/unknown grids remain in plan view. CRSs that require unavailable datum grids show an explanation instead of silently skipping the datum transformation. British National Grid uses a labelled, approximate Helmert transformation for the background map. Web Mercator backgrounds are limited to approximately 85° latitude.

```sh
npm run test:maps
```

The map checks cover CRS metadata, country/name/code search, international projection checkpoints, source-grid and unit guards, metric result conversion, heatmap cell geometry, bounded TIN drawing, settings persistence, and the actual upload worker.

## GIS export

Open `/tools/gis-export` and choose **Load demo**, or select a CSV, TXT or ASCII DXF file. Select the actual input coordinate system before exporting. The demo uses NZTM2000.

CSV and TXT produce points. DXF retains model-space POINT entities, block insertion points, LINE entities, straight LWPOLYLINE entities and classic 2D/3D POLYLINE/VERTEX sequences. Closed boundaries become polygons. Heights retain the input vertical datum during horizontal reprojection.

A Shapefile ZIP contains separate PointZ, PolyLineZ and PolygonZ datasets, each with SHP, SHX, DBF, PRJ and CPG files. A GeoPackage contains the corresponding geometry tables and CRS metadata. Geometry stays in the browser; the first GeoPackage export needs an internet connection to load its SQLite runtime.

Block definition contents and paper-space geometry are excluded. Curved polylines, arcs, splines, meshes and Civil 3D proxy objects are reported rather than converted to inaccurate straight geometry. Export native Civil 3D objects to supported AutoCAD geometry before using this tool.

## Help and feedback

The `/help` page has quick guides, positive feedback, issue reports and questions/ideas. It is linked from the navigation, footer and a floating button on every tool.

With `SUPABASE_URL` (or `VITE_SUPABASE_URL`) and the server-only `SUPABASE_SECRET_KEY` configured, feedback is stored privately in the `site-feedback` Storage bucket. The server creates the private bucket on first submission. Owners can read the dated JSON records in Supabase Storage. Optional reply addresses are private and sender IPs are not stored in the records.

When private delivery is not configured, the form clearly offers a public GitHub issue for review before posting. It requires a GitHub account and never includes the optional email address. Failed private submissions retain the message and never show a success acknowledgement.

```sh
node --import tsx scripts/validate-feedback.mjs
```

## Geometry validation

```sh
npm install --no-save --package-lock=false sql.js@1.14.1 tsx@4.23.15
node --import tsx scripts/validate-dxf-geometry.mjs
node --import tsx scripts/validate-gis-geometry.mjs
python scripts/validate-gis-files.py
```

The checks cover model-space filtering, block references, 2D/3D polyline elevations, OCS transformations, malformed/unsupported geometry, coordinate round trips, and the synthetic demo from DXF through both GIS formats. Python independently checks ZIP integrity, Shapefile offsets and records, SQLite integrity, CRS metadata, ring orientation and 3D coordinates.

Pull requests run the production build, lint and geometry checks before merge. Merging `main` triggers Vercel production deployment.

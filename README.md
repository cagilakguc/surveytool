# SurveyTool.io

Browser-based tools for survey file conversion and civil engineering checks. Built with React, TypeScript, Vite and Tailwind, with GitHub and Vercel deployments.

## Tools

- CSV to DXF with column mapping, optional heights/codes, labels and R12-compatible layers.
- LandXML viewer with surface, alignment and point previews.
- Global street and aerial backgrounds in LandXML Viewer and Surface Compare, with searchable EPSG selection and map preferences saved per project on the current device.
- Cross-sections, surface comparison and pavement conformance.
- Global coordinate and point-file conversion with country-first selection and direct EPSG search; CSV, TXT, DXF, KML and GeoJSON exports.
- Global GIS export to 3D Shapefile ZIP and GeoPackage, including separate point, line and polygon layers and searchable input/output EPSG coordinate systems.
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

Import a LandXML file and use **Map & coordinates** to confirm its source CRS. Recognised EPSG attributes and exact grid names are read from LandXML by both parsers. Otherwise choose a country or territory, then a grid or zone, or search directly by EPSG code. Each input file has its own setting. The EPSG catalogue is generated locally from `epsg-index` before development and production builds; its attribution is included in `public/data`.

Street maps use OpenFreeMap; aerial imagery uses Esri World Imagery. Both show their provider attribution. **No background**, overlay opacity, pan/zoom, **Fit to surface** and the original plan preview are available. Files stay in the browser; background requests go directly to the selected map provider. Project map preferences are saved in local storage and are not account-synchronised.

Surface comparison requires matching source grids and compatible linear units. Results use metres, square metres and cubic metres, including when both input surfaces use feet. Map reprojection is for display and does not change survey coordinates or the volume calculation. Vertical datums are retained and must be compatible. Local/unknown grids remain in plan view. CRSs that require unavailable datum grids show an explanation instead of silently skipping the datum transformation. British National Grid uses a labelled, approximate Helmert transformation for the background map. Web Mercator backgrounds are limited to approximately 85° latitude.

```sh
npm run test:maps
```

The map checks cover CRS metadata, country/name/code search, international projection checkpoints, source-grid and unit guards, metric result conversion, heatmap cell geometry, bounded TIN drawing, settings persistence, and the actual upload worker.

## GIS export

Open `/tools/gis-export` and choose **Load demo**, or select a CSV, TXT or ASCII DXF file. Select the actual input coordinate system before exporting. The demo uses NZTM2000.

Input and output CRS selectors use the same country-first picker as LandXML Viewer, Surface Compare and Coordinate Converter. Search countries by name or ISO code, then choose a CRS by grid name, zone or EPSG code. The input starts unassigned; it is never inferred from browser location or coordinate magnitude. WGS 84 is the default output. **Use input CRS for output** preserves X/Y while attaching the source CRS. Preferences are saved on the current device. CSV/TXT headers accept Longitude/Latitude as X/Y aliases; coordinate values use decimal points.

The exporter reprojects points, every line vertex and every polygon ring, retaining IDs, layer codes, holes, Z values, original height units and the vertical datum. Horizontal foot/metre conversions do not change Z. Output Shapefile PRJ and GeoPackage SRS records use the selected CRS's canonical WKT and EPSG identifier. Grid length/area attributes are converted to metres/square metres for recognised projected units; geographic outputs omit these attributes. Street/aerial previews use the output CRS and never change export coordinates. Large previews draw bounded complete features; exports retain all supported features and vertices.

Required datum grids must be available for a transformation to run. The British National Grid approximation used for a background map is kept separate from the canonical export definition and is never substituted for GIS reprojection. A same-CRS export remains available without a datum-grid download. Local grids need a known CRS or prior georeferencing. Antimeridian-crossing paths need splitting before geographic export.

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
node --import tsx scripts/validate-global-gis.mjs
python scripts/validate-global-gis-files.py
```

The checks cover model-space filtering, block references, 2D/3D polyline elevations, OCS transformations, malformed/unsupported geometry, coordinate round trips, and the synthetic demo from DXF through both GIS formats. Python independently checks ZIP integrity, Shapefile offsets and records, SQLite integrity, CRS metadata, ring orientation and 3D coordinates.

Pull requests run the production build, lint and geometry checks before merge. Merging `main` triggers Vercel production deployment.

## Shared country-first CRS selection

All tools that assign or transform a CRS use `CrsPicker`. The catalogue contains 6,983 horizontal EPSG definitions from the installed `epsg-index` snapshot; it does not claim every custom, vertical, geocentric or epoch-dependent system. The 249 ISO country/territory names plus Kosovo come from [umpirsky/country-list](https://github.com/umpirsky/country-list); name aliases and territorial names handle differing EPSG terminology. National and regional systems use EPSG area descriptions. WGS 84 UTM/UPS discovery also intersects per-polygon country extents derived from [country-coder](https://github.com/rapideditor/country-coder), including islands and date-line splits. These are browsing filters, not boundary validation. Source notices are included under `public/data`. Refresh the checked-in country names, aliases and derived extents when those sources change; EPSG definitions regenerate on every build.

The picker shows recent and common systems before other results. Search and **Show next 100 systems** reach the full catalogue. Direct EPSG lookup searches all countries. Changing country/type/search filters never changes an assigned CRS; an out-of-filter selection stays visible until explicitly changed. CRS choices and the last browsed country are remembered on the current device; blocked or malformed storage does not stop conversion. Input and output country filters remain independent.

Coordinate Converter uses canonical definitions and the same horizontal transformation as GIS Export, preserving IDs, feature codes, Z and source height units. KML/GeoJSON use WGS 84 longitude/latitude. DXF output retains the existing projected-metre requirement. Required datum grids must be available; the approximate map transform is never used for converted files. Plain CSV/TXT to DXF copies coordinates without reprojection; use Coordinate Converter when changing grids.

```sh
npm run test:crs
```

The CRS checks cover country aliases, national/regional grids, UTM/UPS discovery, Pacific date-line islands, polar exclusion, overlapping country names, recent-selection storage, an independent UTM checkpoint, point round trips and each converter export format.

## As-built vs Design and reports

`/tools/as-built-check` compares every valid XYZ point in CSV/TXT or model-space DXF geometry with a selected LandXML TIN. Choose the actual design and point-file CRSs, specify height units separately, name the common vertical datum and confirm that the measured heights use it. Supported horizontal reprojection runs before the TIN query. Heights only undergo explicit unit scaling; vertical datums are never changed. Each point is PASS, HIGH, LOW, OUTSIDE, NO_DESIGN_LEVEL, AMBIGUOUS or INVALID. Limits are inclusive. Conflicting overlapping faces and missing levels remain unassessed. Original triangle interpolation never extrapolates across holes; both XML parsers exclude invisible `F i="1"` faces. Boundary-only polygons without excluded faces require a clipped/visible-face TIN export before this new check can run.

The check runs in a cancellable worker with limits of 250,000 measured points and 500,000 TIN faces. A bounded index avoids unbounded triangle-cell replication. The map and table are previews; statistics and CSV use every valid parsed point. Parser warnings identify skipped input rows/unsupported DXF geometry. PDF includes metadata, summary, plan and up to 2,000 appendix rows, explicitly labelled when truncated. Excel supports up to 100,000 rows; CSV carries the complete result set. Report text supports Latin, Greek and Cyrillic characters using the bundled licensed DejaVu Sans subset. Exact text is retained in Excel and CSV. Report libraries load only when an export is requested.

The same PDF/Excel/CSV report controls are available for Surface Compare, Cross Sections and Pavement Conformance. Existing pavement matching/thickness calculations and the original CSV export remain in place for user field testing. Cross-section distances, chainage and RL stay in source units; thickness/differences are converted to mm for recognised linear units.

## Pavement Conformance maps

Pavement Conformance's thickness pass/fail map supports the shared country-first CRS picker, street and Esri aerial/satellite backgrounds, point opacity and source-grid plan. Both CSV/TXT files must already use the same projected metre grid and height datum. The selected CRS positions the map only; matching, thicknesses and tolerances retain the original coordinates. Mount Eden 2000 is EPSG:2105; do not substitute another Mount Eden datum/version. Unknown/local, unsupported-unit and failed map transformations retain the plain plan and full results. Interactive previews sample up to 5,000 matched points; statistics and reports use all matches. Map preferences are saved per filename pair and included in portable workspaces; old workspaces without map preferences still open. Report metadata records the user-selected CRS.

## Saved workspaces

Use **Save / reopen project** in As-built vs Design, LandXML Viewer, Surface Compare, Cross Sections, Pavement Conformance, Coordinate Converter and GIS Export. IndexedDB stores parsed files and settings on the current browser/device; `/projects` lists them. This is separate from account-backed Supabase uploads. Download `.surveytool.json` for a portable backup; reopening validates the version/tool and input shapes, restores files/settings, and recalculates results. Cross-section bundles retain drawn endpoints and surface/alignment selections. Clearing browser site data removes device saves. Blocked/quota-limited storage shows an error and portable export remains available.

## Datum operation guard

Canonical GIS/converter exports and as-built coordinate transformations now reject GDA94/GDA2020 changes to other datums until an explicit, verified operation is available. Same-CRS export and projections on the same underlying datum remain available. Shared ellipsoids, identical PROJ definitions or finite output are not evidence of datum equivalence. Other pairs without a documented catalogue link, conflicting zero shifts, and optional-grid/null fallback operations are blocked. Missing mandatory grids continue to stop conversion. The background-map approximation remains separate. This mitigates issue #21 without claiming that Australian conformal/distortion-grid transformations are implemented.

Validation:

```sh
npm run test:datum
npm run test:asbuilt
```

Checks include independent analytical TIN planes and exact tolerance boundaries, mixed height units, shared edges, holes, invisible faces in the actual XML worker, missing elevations, conflicting faces, malformed projects, unsafe datum pairs, unchanged source inputs, CSV formula guards, numeric Excel readback and PDF text/font output. The font is derived from DejaVu Sans; its licence is included under `public/fonts`.

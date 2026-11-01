# Terrain, offline projects and visitor reports

## Contours to 3D Terrain

Open `/tools/contours-to-terrain`. The first release accepts ASCII DXF model-space lines and straight 2D/3D polylines, including closed contours. Export DWG source drawings to ASCII DXF; direct DWG and PDF reconstruction are later phases. Curves and block contents are not automatically reconstructed.

1. Import a drawing up to 50 MB and choose the contour layers.
2. Confirm the drawing units, existing projected grid and vertical datum. This tool retains coordinates and heights; it does not reproject them.
3. Review contour heights. Missing, zero or nonconstant CAD elevations are left unassigned. Enter a true zero explicitly. Exclude non-contour linework.
4. Optionally select a closed polyline as a clipping boundary. That path is excluded from the contour set. Concave boundaries clip the TIN itself, without extrapolation outside source coverage.
5. Generate and inspect the 3D TIN. A software 3D renderer supports devices without WebGL. Exaggeration affects the preview only.
6. Export LandXML, an R12 DXF containing 3DFACEs, or a PDF summary. DXF coordinates retain source units; confirm matching drawing units when opening in CAD. LandXML records the chosen linear units and grid metadata.

The triangulation preserves contour segments as constraints. Crossings, overlaps, unsplit junctions and conflicting elevations at the same XY position are rejected. Terrain between contours is interpolated. Flat hilltops or depressions cannot be resolved without additional surveyed information. The initial limit is 30,000 TIN input vertices; use a smaller area or fewer layers for larger surveys. Optional supplementary spacing adds points along source segments, not additional measured terrain detail.

Use **Open in Cross Sections** to create a saved cross-section workspace containing the generated surface. A drawn section works without an alignment. Save the terrain workspace separately to retain its editable source contour heights.

## Offline field use

Open the app online after deployment and allow the service worker to finish preparing. `/projects` checks offline readiness against the active version's full cached asset list, including workers, coordinate-system data and the report font. If an update is waiting, save work, close all SurveyTool windows, then reopen.

Saved projects retain geometry and settings in IndexedDB on the current device/browser. They are independent of login and cloud storage. Save completion is reported only after the transaction commits. A failed or aborted update leaves the previous project intact. Users can request persistent browser storage, download a portable JSON backup, or remove an unneeded saved copy.

The offline app can reopen saved LandXML, cross-section and terrain data, run local calculations and generate exports. Background maps, cloud accounts and online services still require a connection. Choose the source-grid plan when background imagery is unavailable. Browser eviction, clearing site data or losing the device can remove local projects: keep downloaded project backups.

## Visitor analytics and Google Search

The production app includes Vercel Web Analytics page-view instrumentation on `surveytool.io` and `www.surveytool.io` only. Preview/local sessions are excluded. Query parameters, project identifiers and URL fragments are removed before sending page-view events. Auth/dashboard pages and custom events are excluded. Survey file contents, coordinates, names and analysis settings are not sent by this integration.

To activate collection, enable **Web Analytics** for the production Vercel project. Use its Analytics dashboard to inspect visitors, page views, referral sources and countries. The code alone does not enable the account setting or recover earlier uncollected traffic.

Google search impressions, search clicks, queries and searcher countries are separate reports in **Google Search Console**. An authorized account must have a verified property for `surveytool.io`; DNS verification can exist even without a verification tag in the source. Read actual account reports before quoting figures. A public search result is not evidence of a visitor count.

## Validation

- `npm run test:terrain`: analytical slope, preserved constraint edges, exact concave clipping, malformed geometry, actual CAD parsing and export structure.
- `npm run test:offline`: IndexedDB save/open/update/backup/remove; failed transaction recovery; offline deep links and query-versioned coordinate data; cached report font; cache readiness and cleanup; analytics URL sanitization.
- `npm run build`: generates the versioned production offline shell. The existing map, CRS, datum, as-built and section validation scripts cover regression behavior.

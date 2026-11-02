# LandXML display and usage reporting

## Display

The LandXML Viewer draws every valid triangle in plan and map views. Plan drawing interpolates the original triangle plane at each display pixel in a worker, redrawing at device-pixel resolution after zooming. It uses viewport culling rather than thousands of SVG nodes or every-nth-face sampling. Shared edges remain continuous and drawing does not block the page. Map triangles are grouped into elevation bands without removing geometry. Real gaps in the source TIN remain gaps.

Elevation colours and optional TIN edges make surfaces readable at different zoom levels. Plan hover retains the complete TIN interpolation index; full-detail map hover uses the original source-grid triangles. A separate 3D tab renders source heights with smooth display lighting, surface selection, orbit/zoom and optional edges. No vertical smoothing changes the survey data. Faces without heights remain available in plan/map and are omitted from 3D with a note.

The existing 100 MB import and 300,000-face interactive safety guards remain. On a browser without hardware 3D, the software view is capped at 60,000 faces; larger surfaces remain available in full-detail plan and map views.

## Usage reporting

Vercel Web Analytics is enabled on the existing Hobby project serving SurveyTool.io. Its page report counts visits to each tool. Page views do not mean an import, calculation or export succeeded. Hobby does not include Web Analytics custom events; no paid upgrade is required or enabled by this change.

`src/lib/toolUsage.ts` prepares optional GA4 action events, with a consent control in `ToolUsageAnalytics`. Collection is **disabled until a real `VITE_GA_MEASUREMENT_ID` is configured**. No fake measurement ID is shipped. The Google Analytics account/property must be set up and the user must approve any required Google terms before activation.

Activation checklist:

1. Create or select the owner's Google Analytics account and a free GA4 web property for `https://www.surveytool.io/`, using Pacific/Auckland time.
2. Disable **all Enhanced Measurement** on its web stream before deploying the measurement ID. Automatic form, search, link and download capture is intentionally excluded; these can contain project information.
3. Add its `G-…` ID as `VITE_GA_MEASUREMENT_ID` to the existing Vercel production project and redeploy.
4. Verify a consenting browser records a real action in Realtime. Verify Essential only, DNT/GPC, offline and preview origins send no action events. The consent control appears only when the real measurement ID is present.

Only bounded tool, action, source, format and display-mode labels are accepted. The code excludes filenames, file contents, coordinates, heights, project IDs, free text and account identifiers. URL queries/fragments and referrers are excluded from action payloads. Ad storage, ad personalisation and Google signals are disabled. Optional analytics cookies expire after one day. Declining or revoking consent blocks optional events and removes host-scoped GA cookies.

Initial event coverage:

| Tool | Counted action |
| --- | --- |
| LandXML Viewer | Successful XML imports; demo opens; plan/map/3D selections |
| CSV/TXT to DXF | DXF prepared for export |
| Coordinate Converter | Converted file prepared for export |
| GIS Export | Shapefile/GeoPackage prepared for export |
| Contours to Terrain | Successful terrain generation; prepared exports |
| As-built vs Design | Successful completed calculation |
| Cross Sections | Successful import batches |
| Surface Compare | Successful XML imports |
| Pavement Conformance | Successful point-file imports; prepared CSV exports |

`export_prepared` counts a generated output, not proof a browser saved a file. Import batches count once per accepted batch. The events indicate features used; they do not establish the purpose of a customer's survey job or identify the customer.

## Verification

`npm run test:viewer` checks a 10,336-face survey grid, a genuine opening, all-face map geometry, exact coordinate/elevation retention, winding, missing heights, true zero heights and input immutability. `npm run test:usage` checks consent and revocation, preview/offline exclusion, DNT/GPC and payload privacy. Existing map and offline regression suites remain applicable.

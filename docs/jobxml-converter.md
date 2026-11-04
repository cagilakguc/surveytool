# JobXML point conversion

`/tools/jxl-to-dxf` imports Trimble JobXML 5.x/6.x **calculated grid points** from
`JOBFile/Reductions/Point/Grid`. It does not compute station setups, replay
observations, apply another atmospheric/prism correction, or run an adjustment.
Field-book point records are counted, not exported as additional coordinates.

The parser uses strict namespace-aware SAX parsing in a worker, rejects DTDs,
limits source size to 50 MB, and supports UTF-8 and BOM-marked/detectable UTF-16.
It retains original East/North/RL values, point names, feature codes, methods and
classifications. Numeric JobXML coordinates are metres; display-unit preferences
are not scale factors. Non-increasing-North/East axes are rejected explicitly.
Deleted records, invalid grid coordinates and conflicting duplicate names are
excluded with visible issues. Identical reduced duplicates are collapsed.
Geographic-only and raw-observation-only jobs cannot supply DXF grid points.

The default 3D output excludes points with missing RLs. The user can explicitly
choose a flat 2D drawing at Z=0 instead; source CSV retains available source RLs.
The shared DXF writer preserves the existing CSV/TXT tool's R12 output by
default. JobXML output uses UTF-8 DXF 2007 with `$INSUNITS=6` (metres), 3D POINT
entities and optional point/RL/code TEXT entities. Feature-code layers follow the
existing 31-character ASCII sanitization. No lines are invented from point order
or shared codes. Connecting strings and curves require a later validated reader.

The original job is never changed or uploaded. The public demo is synthetic;
real survey datasets used for local QA must not be committed to the repository.
Direct Leica DBX import remains pending a complete sample job and a suitable
reader; a JXL/DBX filename is never treated as a CSV file.

References checked during implementation:

- Trimble JobXML reductions and environment: https://help.fieldsystems.trimble.com/tbc/4107.htm
- Trimble controller JobXML and raw observations: https://help.fieldsystems.trimble.com/trimble-access/2021.10/en/Projects-and-jobs.htm
- Trimble schema description (mirrored schema): https://github.com/KubaSzostak/JobXML/blob/master/JobXML.xsd
- Leica DBX folder and units: https://rcdocs.leica-geosystems.com/v1/docs/map360-import-leica-dbx

Validation: `npm run test:jxl` checks parsing, deleted/duplicate records, namespace
prefixes, missing/zero heights, display units, encoding, precision, source CSV
and DXF round trips. Pass a local JXL path as an extra argument to validate a real
job against the same exporter. `ezdxf` provides independent CAD-format validation
of local QA outputs when installed. Never put the real input path in tracked code.

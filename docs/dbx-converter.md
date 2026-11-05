# Leica DBX coordinate conversion

`/tools/dbx-to-dxf` processes one job's matching component files locally. It is
an initial, bounded direct reader of the validated ALI page layout, independent
of Leica executables or proprietary runtime libraries. It does not claim to
support every Leica firmware generation or DBX object type.

The reader validates table signatures, page boundaries/counts, live keys,
record counts and all record-fragment sequences. Point coordinates come from
the X01 coordinate objects, never from scanning bytes for plausible numbers or
using the graphics cache. X06 supplies code definitions and X14 assigns main
codes to logical points. There is no required coding template. Unknown
encodings, conflicting code histories, incomplete tables and mixed jobs stop.

Stored numeric coordinate classes are preserved. Duplicate point names across
selected coordinate records are omitted and listed. The user can select a
single class to resolve them. No coordinate priority or averaging is invented.
The reader does not interpret unvalidated private flag bits as a current-point
selection, nor label numeric class values with inferred Leica meanings.

Two coordinate profiles are supported:

- Stored increasing North/East grid coordinates with stored RLs, in metres.
  Their datum is not inferred from coordinate magnitude. Preserve source RLs,
  or explicitly confirm source vertical datum and NZTM2000 for conversion.
- Stored geographic radians and ellipsoidal heights in a job with the validated
  GRS80, NZTM2000 parameter block, and identity WGS84-NZGD2000 job transformation.
  Those definitions are checked numerically, including the transformation
  parameter block. No epoch transformation or custom calibration is substituted.

New output defaults to NZVD2016. Auckland 1946 remains available. The LINZ
package version 20200110 provides NZGeoid2016 and AUK46-NZVD16 v2016.1. Full
unmodified GTX bytes are distributed compressed, with source URLs, SHA-256 and
CC BY 4.0 attribution in `public/height-models/sources.json`. Each model is
decompressed, checked and bilinearly interpolated. Outside coverage, invalid
nodes, missing models or integrity failures stop the conversion.

The equations are `H_NZVD2016 = h_NZGD2000 - N` and
`H_AUCK46 = H_NZVD2016 + o_AUCK46`. Converting stored Auckland 1946 RLs to
NZVD2016 subtracts the interpolated local relationship offset. There is no
constant regional shift, automatic relabelling, or whole-project datum change.
Historic controller GEM interpolation can differ slightly from these published
grids; a reference export is a check, not a correction fitted to the model.

Public verified model bytes are cached separately from the app shell for
subsequent offline use. Survey files, point names and coordinate values never
enter that cache or analytics. Model availability is required before conversion.

DXF uses the shared DXF 2007 metre writer with 3D POINT/TEXT entities. The output
datum is present in filenames and DXF comments. Flat 2D output sets drawing Z=0
while optional RL labels retain the selected output datum. CSV includes output
datum/grid, full-precision output values and original stored values. No point
order, shared code or geometry component causes automatic linework. Code
attributes, observation reduction, station recalculation, stringing and curves
remain out of scope. The original job remains unchanged.

Run `npm run test:dbx`. Optional local QA accepts
`node --import tsx scripts/validate-dbx.mjs <folder> <job-stem> <reference.csv>`.
Real data and paths must remain outside the public repository. The UI example
is synthetic. `ezdxf` can audit the generated local QA DXF independently.

Primary references:

- LINZ models, licences and equations: https://github.com/linz/proj-datumgrid-nz
- LINZ height transformation equations: https://www.linz.govt.nz/guidance/geodetic-system/understanding-coordinate-conversions/height-datum-conversions/equations-vertical-datum-transformations
- LINZ national datum: https://www.linz.govt.nz/guidance/geodetic-system/coordinate-systems-used-new-zealand/vertical-datums/new-zealand-vertical-datum-2016-nzvd2016
- Leica DBX units and component-job import: https://rcdocs.leica-geosystems.com/v1/docs/map360-import-leica-dbx

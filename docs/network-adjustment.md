# Network adjustment v1

`/tools/network-adjustment` implements local weighted least squares for reduced
levelling observations and 2D plane/grid control networks. It is a first
calculation and review workflow, not a STAR*NET file-format implementation.
Raw DBX/JXL reduction and DAT import await comparison with the user's actual
Excel calculations, matching DAT input and STAR*NET listing.

## Input contract

Point CSV: `Point,Easting,Northing,RL,Fixed`. IDs are case-sensitive. Fixed
control is exact. All 2D points need approximate E/N in metres. Level networks
need fixed RLs; a free point's initial RL can be blank. The grid and datum
are explicit labels and do not invoke a coordinate transformation.

Observation CSV: `ID,Type,From,To,Back,Value,Sigma,Set,Length_km,Enabled`.
Optional columns can be omitted; included blank cells retain delimiters.
Comma, semicolon, tab or whitespace delimited files are accepted. Quoted
multiline fields, duplicate/unknown headers and incomplete rows are rejected.
No row is silently discarded. One independent measurement per row:

| Type | Equation / convention | Value | Sigma |
| --- | --- | --- | --- |
| DH | H(To) - H(From) | m | mm |
| HD | Plane distance From-To | grid m | mm |
| AZ | Grid azimuth, clockwise from north | degrees or D:M:S | arcseconds |
| HA | At From, clockwise Back to To | degrees or D:M:S | arcseconds |
| DIR | Grid azimuth - setup orientation | circle degrees or D:M:S | arcseconds |

Direction orientations are distinct for every `(station, Set)` pair. Use a
new set for each changed circle orientation; instrument faces, repeated
directions and derived angles are not automatically reduced or correlated.
Packed D.MMSS, gons and quadrant bearings are not supported. Negative angular
values wrap onto the circle. In particular `123.4506` means decimal degrees.

Blank Sigma uses the project angular sigma, an explicitly selected additive
or quadrature EDM model, or `level_mm_per_sqrt_km × sqrt(Length_km)`. The
distance-dependent EDM term is `distance_m × ppm / 1000` in mm. A DH without
Sigma must include a positive length; no default length is invented. An
explicit Sigma overrides defaults. Total supplied sigmas must include all
relevant measurement and centering errors.

Exclusions are explicit and survive backups, input review and complete
exports. Suspect observations are never automatically removed or reweighted.
The user confirms that observations have been reduced before calculation.

## Solution and statistical conventions

The objective is `sum((computed - observed)^2 / sigma^2)`. Angular differences
are wrapped to the nearest signed circle difference. Analytical observation
derivatives are iterated with damped Gauss-Newton, using column-scaled,
column-pivoted Householder QR. Normal equations are not inverted. Each update
must reduce the objective. Rank deficiency, missing observations for an
unknown, degenerate initial geometry and nonconvergence stop without results.
There are no implicit datum fixes. Limits: 80 points, 2,000 observations,
200 coordinate/orientation unknowns and 30 nonlinear iterations. Meaningful
approximate positions are required; local minima and mirror configurations
cannot be excluded by a passing linearized test.

Covariance is `Q=(A' P A)^-1`, recovered from the QR factors, in native metre
and radian parameter units. It is a priori and **not** multiplied by a
posterior variance factor. Point sigmas and 95% ellipses use this covariance.
Ellipse semiaxes are covariance eigenvalue square roots multiplied by
`sqrt(chi2_quantile(0.95, 2)) = 2.44774683068`; bearing is clockwise from north
modulo 180 degrees. The plot explicitly magnifies ellipses without changing
reported lengths. Level plots use schematic input order on the horizontal
axis, not invented geographic positions.

Residual is adjusted minus observed; prefit misclosure is observed minus
computed at the initial positions. With weighted Jacobian `Aw`, leverage is
`Aw[i] Q Aw[i]'` and redundancy is `r=1-leverage`. Standardized residuals are
`v/(sigma*sqrt(r))`. No value is reported when redundancy is effectively zero.
Absolute values over 3 are screening flags, not automatic rejection or a
familywise multiple-testing decision. Values under 5% redundancy are marked
weak. The sum of redundancies equals degrees of freedom.

The global test uses the two-sided 95% chi-square bounds at
`dof=number_of_included_observations-number_of_unknowns`, on `v'Pv` itself.
The estimated standard-deviation factor is `sqrt(v'Pv/dof)`. Both high and low
statistics are shown. Zero DOF disables that test and factor rather than
inventing precision checks. All-fixed networks can check observations without
coordinate unknowns. Neither a global test nor small residuals certify the
absence of blunders or accuracy of fixed control.

Level closure checks use a spanning-tree cycle basis with exact benchmark
ties. Misclosure is chord DH minus tree-path DH; loop sigma is the quadrature
sum of its independent observation sigmas. Input order determines the basis,
and loops sharing measurements are correlated. Total length is blank when
any measured leg lacks length metadata. This is not a general 2D traverse
angular/coordinate misclosure computation.

## Output, storage and scope

Points CSV, complete residual CSV (including exclusions), full a priori
covariance CSV, complete calculation JSON and a multipage PDF report are
available. Horizontal DXF uses adjusted E/N with Z=0 and fixed/adjusted layers;
source heights are never represented as vertically adjusted. Level E/N and
horizontal-mode source RLs are explicitly labelled unadjusted in CSV.
Reports contain the conventions, checks and exclusions, not just coordinates.
Saved projects retain the original CSV text, settings and exclusions locally;
results are invalidated on changes and recomputed after reopening. Inputs,
IDs and coordinates never enter analytics. The app shell and bundled report
font support offline recalculation and export after normal offline preparation.

Not included: raw observation reduction, slope/zenith/3D adjustment, correlated
GNSS vectors, soft/stochastic control, free-network datum constraints, robust
estimation or automatic outlier deletion. These require separate validation.

## Verification and references

Run `npm run test:network`. The committed synthetic fixtures are independently
computed by `scripts/network-reference.py` using NumPy least squares/SVD and
SciPy numerical-derivative nonlinear least squares and chi-square quantiles.
The tests compare adjusted coordinates, orientations, full covariance,
residuals, redundancy and statistical bounds. Closed-form unequal-weight
benchmark ties, reversed observations, no redundancy, all-fixed checks,
blunders, angular wrapping, independent setups, disconnected/collinear/
underdetermined networks, nonconvergence, maximum supported level-network
size, CSV validation, backups and worker errors have separate coverage.
No real survey files are committed.

Primary mathematical and workflow references:

- GNU Gama: https://www.gnu.org/software/gama/manual/gama.html
- NOAA NGS levelling weights: https://www.ngs.noaa.gov/PUBS_LIB/NAVD88/navd88report.htm
- MicroSurvey input conventions: https://helpdesk.microsurvey.com/en-us/article/1120-summary-of-star-net-input-data-types-and-inline-options
- MicroSurvey instrument settings: https://helpdesk-microsurvey.kayako.com/article/1293-instrument-settings

Similar concepts do not imply numerical equivalence with a particular
STAR*NET project. Its units, reductions, correlations, centering errors,
control constraints and covariance scaling must match before comparison.

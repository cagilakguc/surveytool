# GIS point-column mapping

CSV and TXT imports in GIS Export now open a column selector before importing points. Recognised headings suggest Easting/X/Longitude, Northing/Y/Latitude, Elevation/RL, point ID and feature code. Headerless and unrecognised layouts require the user to assign the coordinate columns explicitly. A source preview shows the first five data rows, column numbers and their assignments.

Easting and Northing are required and must use different columns. A selected Elevation column must also be distinct; invalid or missing selected numeric values are skipped with a row count. Zero and negative heights remain valid. Choosing no Elevation explicitly produces Z=0 and a warning that measured heights have not been inferred. Point IDs and feature codes are optional; missing IDs are generated.

Changing a column or the heading checkbox clears the mapped geometry and prepared downloads until Apply column mapping is used again. Both the map and Shapefile/GeoPackage export use the newly mapped points. Saved projects retain the mapped geometry; reselect the original CSV/TXT to change column assignments after reopening a project. DXF point/line/polygon import continues without a column selector.

Supported delimiters are comma, tab, semicolon and whitespace. Quoted commas and quoted thousands separators are supported. Decimal values use a dot; ambiguous decimal commas are rejected rather than silently converted. Source limits remain 50 MB and 500,000 points.

`npm run test:gis-columns` checks custom and shuffled headings, headerless Northing/Easting order, optional heights, IDs/codes, numeric validation and exported binary PointZ coordinates. Existing mixed/global GIS tests cover reprojection and geometry formats.

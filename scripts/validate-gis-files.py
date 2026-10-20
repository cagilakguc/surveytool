"""Read exported GIS files independently of the JavaScript writers."""
import sqlite3
import struct
import zipfile


def read_wkb(blob):
    assert blob[:4] == b"GP\x00\x01"
    assert struct.unpack_from("<i", blob, 4)[0] == 2193
    assert blob[8] == 1
    kind = struct.unpack_from("<I", blob, 9)[0]
    offset = 13

    def coordinates(count):
        nonlocal offset
        values = [struct.unpack_from("<ddd", blob, offset + i * 24) for i in range(count)]
        offset += count * 24
        return values

    if kind == 1001:
        result = [coordinates(1)]
    elif kind == 1002:
        count = struct.unpack_from("<I", blob, offset)[0]
        offset += 4
        result = [coordinates(count)]
    else:
        assert kind == 1003
        ring_count = struct.unpack_from("<I", blob, offset)[0]
        offset += 4
        result = []
        for _ in range(ring_count):
            count = struct.unpack_from("<I", blob, offset)[0]
            offset += 4
            result.append(coordinates(count))
    assert offset == len(blob)
    return kind, result


for stem, counts in [("mixed-validation", (2, 1, 1)), ("demo-validation", (2, 2, 1))]:
    with zipfile.ZipFile(f"/tmp/{stem}.zip") as archive:
        assert archive.testzip() is None
        for suffix, shape_type, expected_count in zip(("points", "lines", "polygons"), (11, 13, 15), counts):
            base = f"{stem}_{suffix}"
            required = {f"{base}.{extension}" for extension in ("shp", "shx", "dbf", "prj", "cpg")}
            assert required.issubset(archive.namelist())
            data = archive.read(base + ".shp")
            assert struct.unpack_from(">i", data, 0)[0] == 9994
            assert struct.unpack_from(">i", data, 24)[0] * 2 == len(data)
            assert struct.unpack_from("<ii", data, 28) == (1000, shape_type)
            shx = archive.read(base + ".shx")
            dbf = archive.read(base + ".dbf")
            assert (len(shx) - 100) // 8 == expected_count == struct.unpack_from("<I", dbf, 4)[0]
            assert 'AUTHORITY["EPSG","2193"]' in archive.read(base + ".prj").decode()
            assert archive.read(base + ".cpg") == b"UTF-8"
            offset, count = 100, 0
            while offset < len(data):
                record, words = struct.unpack_from(">ii", data, offset)
                assert record == count + 1
                assert struct.unpack_from(">ii", shx, 100 + count * 8) == (offset // 2, words)
                content = data[offset + 8:offset + 8 + words * 2]
                assert struct.unpack_from("<i", content, 0)[0] == shape_type
                if shape_type == 11:
                    xyz = struct.unpack_from("<ddd", content, 4)
                    assert len(content) == 36
                    if count == 0:
                        assert xyz == (1755000.125, 5923000.25, 12.3456)
                else:
                    parts, points = struct.unpack_from("<ii", content, 36)
                    xy_start = 44 + parts * 4
                    z_start = xy_start + points * 16
                    xyz = [(*struct.unpack_from("<dd", content, xy_start + i * 16), struct.unpack_from("<d", content, z_start + 16 + i * 8)[0]) for i in range(points)]
                    assert len(content) == z_start + 16 + points * 8
                    assert struct.unpack_from("<dd", content, z_start) == (min(p[2] for p in xyz), max(p[2] for p in xyz))
                    if stem == "demo-validation" and suffix == "lines" and count == 1:
                        assert [p[2] for p in xyz] == [12.15, 12.3, 12.45]
                    if suffix == "polygons":
                        assert xyz[0] == xyz[-1]
                        signed_area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(xyz, xyz[1:])) / 2
                        assert signed_area == -400, "Shapefile exterior rings must be clockwise"
                offset += 8 + words * 2
                count += 1
            assert offset == len(data) and count == expected_count

    with sqlite3.connect(f"/tmp/{stem}.gpkg") as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        geometry_columns = db.execute("SELECT table_name,geometry_type_name,srs_id,z,m FROM gpkg_geometry_columns").fetchall()
        assert len(geometry_columns) == 3
        table_counts = dict(zip(("survey_points", "survey_lines", "survey_polygons"), counts))
        for table, kind, srs, z, m in geometry_columns:
            expected_count = table_counts[table]
            assert (srs, z, m) == (2193, 1, 0)
            blobs = db.execute(f"SELECT geom FROM {table} ORDER BY fid").fetchall()
            assert len(blobs) == expected_count
            for blob, in blobs:
                wkb_type, coordinates = read_wkb(blob)
                assert wkb_type == {"POINT": 1001, "LINESTRING": 1002, "POLYGON": 1003}[kind]
                if kind == "POLYGON":
                    ring = coordinates[0]
                    assert ring[0] == ring[-1]
                    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2
                    assert area == 400, "GeoPackage exterior rings must be counterclockwise"
            if table == "survey_points":
                assert db.execute("SELECT elevation FROM survey_points ORDER BY fid LIMIT 1").fetchone()[0] == 12.3456
            if table == "survey_polygons":
                assert db.execute("SELECT area_m2 FROM survey_polygons LIMIT 1").fetchone()[0] == 400
    print(f"{stem}: independent ZIP, Shapefile, SQLite, CRS and 3D coordinate checks passed")

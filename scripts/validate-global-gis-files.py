import json
import math
from pathlib import Path
import sqlite3
import struct
import zipfile

root = Path('/tmp/global-gis-validation')

def unpack(fmt, data, offset=0):
    return struct.unpack_from(fmt, data, offset)

def wkb(blob, code):
    assert blob[:2] == b'GP'
    assert unpack('<i', blob, 4)[0] == code
    assert blob[8] == 1
    kind = unpack('<I', blob, 9)[0]
    offset = 13
    def points(count):
        nonlocal offset
        values = [unpack('<ddd', blob, offset + i * 24) for i in range(count)]
        offset += count * 24
        return values
    if kind == 1001:
        result = [points(1)]
    elif kind == 1002:
        count = unpack('<I', blob, offset)[0]
        offset += 4
        result = [points(count)]
    else:
        assert kind == 1003
        count = unpack('<I', blob, offset)[0]
        offset += 4
        result = []
        for _ in range(count):
            n = unpack('<I', blob, offset)[0]
            offset += 4
            result.append(points(n))
    assert offset == len(blob)
    return result

def dbf(data):
    count = unpack('<I', data, 4)[0]
    header, size = unpack('<HH', data, 8)
    fields = []
    for offset in range(32, header - 1, 32):
        name = data[offset:offset+11].split(b'\0')[0].decode('ascii')
        fields.append((name, chr(data[offset+11]), data[offset+16]))
    rows = []
    for i in range(count):
        offset = header + i * size + 1
        row = {}
        for name, kind, width in fields:
            value = data[offset:offset+width].decode('utf-8').strip()
            row[name] = float(value) if kind == 'N' and value else value
            offset += width
        rows.append(row)
    return rows

def compare_vertices(actual, expected):
    assert len(actual) == len(expected)
    assert sorted(actual) == sorted((v['easting'], v['northing'], v['elevation']) for v in expected)

def area(ring):
    # Shift the origin to avoid cancellation in very large projected coordinates.
    x, y = ring[0][:2]
    return sum((a[0]-x)*(b[1]-y)-(b[0]-x)*(a[1]-y) for a, b in zip(ring, ring[1:])) / 2

for expected_path in sorted(root.glob('*.json')):
    expected = json.loads(expected_path.read_text())
    layer, code = expected['layer'], expected['code']
    name = expected_path.stem
    with zipfile.ZipFile(root / f'{name}.zip') as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == 15
        for kind, features, shape_type in [('points',layer['points'],11), ('lines',layer['lines'],13), ('polygons',layer['polygons'],15)]:
            stem = f'{name.replace("-", "_")}_{kind}'
            # Export base names permit hyphens; select the unique geometry suffix.
            shp_name = next(item for item in archive.namelist() if item.endswith(f'_{kind}.shp'))
            stem = shp_name[:-4]
            shp, shx = archive.read(shp_name), archive.read(stem+'.shx')
            assert unpack('>i', shp)[0] == 9994
            assert unpack('<i', shp, 32)[0] == shape_type
            assert unpack('>i', shp, 24)[0] * 2 == len(shp)
            assert len(shx) == 100 + len(features) * 8
            assert f'"EPSG","{code}"' in archive.read(stem+'.prj').decode()
            assert archive.read(stem+'.cpg') == b'UTF-8'
            records = dbf(archive.read(stem+'.dbf'))
            assert len(records) == len(features)
            offset = 100
            for index, feature in enumerate(features):
                record, words = unpack('>ii', shp, offset)
                assert record == index + 1
                assert unpack('>ii', shx, 100 + index * 8) == (offset // 2, words)
                content = offset + 8
                assert unpack('<i', shp, content)[0] == shape_type
                if shape_type == 11:
                    compare_vertices([unpack('<ddd',shp,content+4)], [feature])
                    assert records[index]['POINT_ID'] == feature['id']
                else:
                    parts, count = unpack('<ii', shp, content+36)
                    starts = list(unpack('<'+'i'*parts, shp, content+44)) + [count]
                    xy_offset = content + 44 + parts * 4
                    z_offset = xy_offset + count * 16 + 16
                    vertices = [(*unpack('<dd', shp, xy_offset+i*16), unpack('<d',shp,z_offset+i*8)[0]) for i in range(count)]
                    rings = [vertices[starts[i]:starts[i+1]] for i in range(parts)]
                    source = [feature['vertices']] if kind == 'lines' else feature['rings']
                    assert len(rings) == len(source)
                    for j, (ring, source_ring) in enumerate(zip(rings, source)):
                        compare_vertices(ring, source_ring)
                        if kind == 'polygons':
                            assert ring[0] == ring[-1]
                            assert (area(ring) < 0) == (j == 0)
                    assert records[index]['FEATURE_ID'] == feature['id']
                assert records[index]['CODE'] == feature['code']
                if expected['geographic']:
                    assert 'AREA_M2' not in records[index] and 'LENGTH_M' not in records[index]
                offset += 8 + words * 2
            assert offset == len(shp)
        if code == 2263:
            foot = 1200 / 3937
            lines = dbf(archive.read(next(item for item in archive.namelist() if item.endswith('_lines.dbf'))))
            polygons = dbf(archive.read(next(item for item in archive.namelist() if item.endswith('_polygons.dbf'))))
            assert math.isclose(lines[0]['LENGTH_M'], 20 * foot, abs_tol=0.00005)
            assert math.isclose(polygons[0]['AREA_M2'], 375 * foot**2, abs_tol=0.00005)
    with sqlite3.connect(root / f'{name}.gpkg') as database:
        assert database.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not database.execute('PRAGMA foreign_key_check').fetchall()
        assert database.execute('SELECT organization,organization_coordsys_id FROM gpkg_spatial_ref_sys WHERE srs_id=?',(code,)).fetchone() == ('EPSG',code)
        for kind, features in [('points',layer['points']), ('lines',layer['lines']), ('polygons',layer['polygons'])]:
            assert database.execute('SELECT srs_id FROM gpkg_geometry_columns WHERE table_name=?',(f'survey_{kind}',)).fetchone()[0] == code
            rows = database.execute(f'SELECT geom,code FROM survey_{kind} ORDER BY fid').fetchall()
            assert len(rows) == len(features)
            for (blob, feature_code), feature in zip(rows, features):
                rings = wkb(blob, code)
                source = [[feature]] if kind == 'points' else [feature['vertices']] if kind == 'lines' else feature['rings']
                for j, (ring, source_ring) in enumerate(zip(rings, source)):
                    compare_vertices(ring, source_ring)
                    if kind == 'polygons': assert (area(ring) > 0) == (j == 0)
                assert feature_code == feature['code']
    print(f'{name}: independent Shapefile, GeoPackage, EPSG, 3D coordinates, rings, attributes and units passed')

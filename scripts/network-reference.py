"""Independent NumPy/SciPy reference. Does not import the TypeScript solver.

Usage: python3 scripts/network-reference.py INPUTS.json OUTPUT.json
Inputs are synthetic NetworkInput objects, not proprietary field data.
"""
import json
import math
import sys
import numpy as np
import scipy
from scipy.optimize import least_squares
from scipy.stats import chi2


def reference(case):
    net = case['input']
    points = {p['id']: p for p in net['points']}
    free = [p for p in net['points'] if not p['fixed']]
    obs = [o for o in net['observations'] if o['enabled']]
    sigmas = np.array([o['sigma'] for o in obs])
    if net['mode'] == 'level':
        a = np.zeros((len(obs), len(free)))
        b = np.array([o['value'] for o in obs])
        for i, o in enumerate(obs):
            for name, sign in [(o['to'], 1), (o['from'], -1)]:
                if points[name]['fixed']:
                    b[i] -= sign * points[name]['height']
                else:
                    a[i, next(j for j, p in enumerate(free) if p['id'] == name)] += sign
        a /= sigmas[:, None]
        b /= sigmas
        x = np.linalg.lstsq(a, b, rcond=None)[0]
        weighted = a @ x - b
        coords = {p['id']: [float(x[j])] for j, p in enumerate(free)}
        orientations = []
        jac = a
    else:
        origin = np.array([net['points'][0]['easting'], net['points'][0]['northing']])
        groups = list(dict.fromkeys((o['from'], o['set']) for o in obs if o['type'] == 'DIR'))

        def positions(x):
            return {name: (np.array([p['easting'], p['northing']]) - origin if p['fixed'] else x[2 * next(j for j, q in enumerate(free) if q['id'] == name):][:2]) for name, p in points.items()}

        initial = [v for p in free for v in (np.array([p['easting'], p['northing']]) - origin)]
        for group in groups:
            o = next(o for o in obs if o['type'] == 'DIR' and (o['from'], o['set']) == group)
            a0, b0 = points[o['from']], points[o['to']]
            initial.append(math.atan2(b0['easting'] - a0['easting'], b0['northing'] - a0['northing']) - o['value'])

        def residual(x):
            pos = positions(x)
            r = []
            for o in obs:
                d = pos[o['to']] - pos[o['from']]
                if o['type'] == 'HD':
                    difference = float(np.linalg.norm(d)) - o['value']
                else:
                    angle = math.atan2(d[0], d[1])
                    if o['type'] == 'HA':
                        dback = pos[o['back']] - pos[o['from']]
                        angle -= math.atan2(dback[0], dback[1])
                    if o['type'] == 'DIR':
                        angle -= x[2 * len(free) + groups.index((o['from'], o['set']))]
                    difference = math.atan2(math.sin(angle - o['value']), math.cos(angle - o['value']))
                r.append(difference / o['sigma'])
            return np.array(r)

        solved = least_squares(residual, np.array(initial), jac='3-point', xtol=1e-13, ftol=1e-13, gtol=1e-11, x_scale='jac', max_nfev=4000)
        if not solved.success:
            raise RuntimeError(solved.message)
        x = solved.x
        weighted = residual(x)
        jac = solved.jac
        coords = {p['id']: [float(v) for v in x[2 * j:2 * j + 2] + origin] for j, p in enumerate(free)}
        orientations = [float(v % (2 * math.pi)) for v in x[2 * len(free):]]
    # SVD inversion of the weighted Jacobian, independent of the app's QR.
    _, singular, vt = np.linalg.svd(jac, full_matrices=False)
    covariance = (vt.T / singular ** 2) @ vt
    redundancy = np.maximum(0, 1 - np.einsum('ij,jk,ik->i', jac, covariance, jac))
    dof = len(obs) - len(x)
    chi = [float(chi2.ppf(p, dof)) for p in (.025, .975)]
    return {"input": net, "coordinates": coords, "orientations": orientations, "covariance": covariance.tolist(), "weightedSum": float(weighted @ weighted), "residuals": (weighted * sigmas).tolist(), "redundancy": redundancy.tolist(), "chiBounds": chi}


if __name__ == '__main__':
    cases = json.load(open(sys.argv[1]))
    output = {'generator': 'scripts/network-reference.py', 'numpy': np.__version__, 'scipy': scipy.__version__, 'cases': [reference(case) for case in cases], 'chiSquareQuantiles': [{'dof': d, 'p': p, 'value': float(chi2.ppf(p, d))} for d in (1, 2, 3, 6, 30, 100, 500, 1800, 2000) for p in (.025, .5, .95, .975)]}
    with open(sys.argv[2], 'w') as f:
        json.dump(output, f, indent=2)
        f.write('\n')

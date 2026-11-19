"""Build public/models/dino.glb: a low-poly paper T-rex with a boombox, as a drop-in Papertrails traveller.

Run:  python3 tools/dino/build_dino.py   (needs numpy only)

The model follows the traveller contract (see src/player/traveller.js and src/assets/loader.js):
  root node 'traveller' -> 'traveller__base_tab', 'traveller__body' (children: arm_l, arm_r, head),
  'traveller__leg_l', 'traveller__leg_r'. Faces +Z, feet at y = 0, about 0.6 units tall.
  Colours are vertex colours (COLOR_0, linear), TEXCOORD_0 = paper fibre, TEXCOORD_1 = -1 (no printed art).
  Material 'paper' for everything, 'glow' for the boombox display (it lights up at night).
Each part's node origin is its hinge (hip, shoulder, neck), so the procedural walk cycle swings it correctly.
"""
import json
import math
import os
import struct

import numpy as np

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'models', 'dino.glb')


def lin(hex_):
    """sRGB hex -> linear rgb."""
    h = hex_.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


GREEN = lin('#7a9440')
GREEN_D = lin('#5f7a2e')
CREAM = lin('#f0e3c6')
RED = lin('#b8341f')
RED_D = lin('#7e2316')
ORANGE = lin('#e8682a')
BROWN = lin('#6e4428')
GOLD = lin('#d2a64c')
DARK = lin('#34302d')
DARK2 = lin('#1f1c1a')
GREY = lin('#8d8780')
EYE = lin('#191410')
GLOW = lin('#ffc45a')


def rot_x(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_z(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def rot_y(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


class Mesh:
    """Flat-shaded triangle soup with one colour per triangle, split into 'paper' and 'glow' primitives."""

    def __init__(self):
        self.tris = {'paper': [], 'glow': []}

    def tri(self, a, b, c, color, inside=None, mat='paper'):
        a, b, c = (np.asarray(p, float) for p in (a, b, c))
        n = np.cross(b - a, c - a)
        if np.linalg.norm(n) < 1e-12:
            return
        if inside is not None and np.dot(n, (a + b + c) / 3 - np.asarray(inside, float)) < 0:
            b, c = c, b
        self.tris[mat].append((a, b, c, color))

    def quad(self, a, b, c, d, color, inside=None, mat='paper'):
        self.tri(a, b, c, color, inside, mat)
        self.tri(a, c, d, color, inside, mat)

    # ---- primitives -------------------------------------------------------------------------------
    def box(self, center, size, colors, R=None, mat='paper'):
        """colors: one colour or dict with keys +x -x +y -y +z -z."""
        c = np.asarray(center, float)
        R = np.eye(3) if R is None else R
        hx, hy, hz = (s / 2 for s in size)
        P = lambda x, y, z: c + R @ np.array([x, y, z])
        faces = {
            '+x': [P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(hx, -hy, hz)],
            '-x': [P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz)],
            '+y': [P(-hx, hy, -hz), P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz)],
            '-y': [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz)],
            '+z': [P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)],
            '-z': [P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, -hy, -hz)],
        }
        for k, q in faces.items():
            col = colors[k] if isinstance(colors, dict) else colors
            self.quad(*q, col, inside=c, mat=mat)

    def disc(self, center, normal_axis, sign, radius, depth, color, sides=8, R=None, rim=None, mat='paper'):
        """Short octagonal prism lying on a face (speaker, button, eye ...). normal_axis 0/1/2, sign +-1."""
        c = np.asarray(center, float)
        R = np.eye(3) if R is None else R
        ax = [i for i in range(3) if i != normal_axis]
        ring0, ring1 = [], []
        for i in range(sides):
            a = 2 * math.pi * (i + 0.5) / sides
            off = np.zeros(3)
            off[ax[0]] = radius * math.cos(a)
            off[ax[1]] = radius * math.sin(a)
            base = off.copy()
            top = off.copy()
            top[normal_axis] = sign * depth
            ring0.append(c + R @ base)
            ring1.append(c + R @ top)
        cen_top = c + R @ (np.eye(3)[normal_axis] * sign * depth)
        inside = c + R @ (np.eye(3)[normal_axis] * sign * depth * 0.5)
        for i in range(sides):
            j = (i + 1) % sides
            self.quad(ring0[i], ring0[j], ring1[j], ring1[i], rim or color, inside=inside, mat=mat)
            self.tri(cen_top, ring1[i], ring1[j], color, inside=inside, mat=mat)

    def loft(self, path, colors_fn, cap_start=True, cap_end=True, profile=None):
        """path: list of (center xyz, hw, ht, hb). Ring plane is perpendicular to the path tangent,
        ring 'up' = tangent x X (dorsal). colors_fn(seg_index, ring_index) -> colour."""
        prof = profile or [(-0.45, 1), (0.45, 1), (1, 0.25), (0.8, -0.55), (0.35, -1), (-0.35, -1), (-0.8, -0.55), (-1, 0.25)]
        pts = [np.asarray(p[0], float) for p in path]
        rings = []
        for i, (c, hw, ht, hb) in enumerate(path):
            c = np.asarray(c, float)
            t = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
            t /= np.linalg.norm(t)
            X = np.array([1.0, 0, 0])
            up = np.cross(t, X)
            up /= np.linalg.norm(up)
            ring = [c + X * px * hw + up * (pu * (ht if pu > 0 else hb)) for px, pu in prof]
            rings.append(ring)
        n = len(prof)
        for i in range(len(rings) - 1):
            mid = (pts[i] + pts[i + 1]) / 2
            for k in range(n):
                k2 = (k + 1) % n
                self.quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k], colors_fn(k, i), inside=mid)
        for idx, on in ((0, cap_start), (len(rings) - 1, cap_end)):
            if not on:
                continue
            cen = np.mean(rings[idx], axis=0)
            inward = pts[1] if idx == 0 else pts[-2]
            for k in range(n):
                self.tri(cen, rings[idx][k], rings[idx][(k + 1) % n], colors_fn(-1, idx), inside=inward)

    def prism(self, poly_zy, x0, x1, face, side, R=None, origin=(0, 0, 0)):
        """Extrude a (z, y) side-profile polygon between x0 and x1 (paper cut-out with cream card edges)."""
        o = np.asarray(origin, float)
        R = np.eye(3) if R is None else R
        poly = list(poly_zy)
        area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
        if area < 0:
            poly.reverse()
        V = lambda x, zy: o + R @ np.array([x, zy[1], zy[0]])
        for x, sgn in ((x0, -1.0), (x1, 1.0)):
            want = R @ np.array([sgn, 0, 0])
            for tri in ear_clip(poly):
                a, b, c = (V(x, p) for p in tri)
                if np.dot(np.cross(b - a, c - a), want) < 0:
                    b, c = c, b
                self.tri(a, b, c, face)
        m = len(poly)
        for i in range(m):
            p, q = poly[i], poly[(i + 1) % m]
            a, b, c, d = V(x0, p), V(x0, q), V(x1, q), V(x1, p)
            # outward normal for a CCW (z, y) polygon: (dy, -dz) in (z, y)
            dz, dy = q[0] - p[0], q[1] - p[1]
            out = R @ np.array([0, -dz, dy])
            nn = np.cross(b - a, c - a)
            if np.dot(nn, out) < 0:
                self.quad(a, d, c, b, side)
            else:
                self.quad(a, b, c, d, side)

    def cone(self, base_center, tip, radius, color, sides=4, axis_hint=(1, 0, 0)):
        b = np.asarray(base_center, float)
        t = np.asarray(tip, float)
        d = t - b
        d /= np.linalg.norm(d)
        u = np.cross(d, axis_hint)
        if np.linalg.norm(u) < 1e-6:
            u = np.cross(d, (0, 1, 0))
        u /= np.linalg.norm(u)
        v = np.cross(d, u)
        ring = [b + radius * (math.cos(2 * math.pi * i / sides + math.pi / 4) * u + math.sin(2 * math.pi * i / sides + math.pi / 4) * v) for i in range(sides)]
        inside = b + (t - b) * 0.25
        for i in range(sides):
            j = (i + 1) % sides
            self.tri(ring[i], ring[j], t, color, inside=inside)
            self.tri(b, ring[j], ring[i], color, inside=inside)


def ear_clip(poly):
    pts = list(poly)
    idx = list(range(len(pts)))
    out = []

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(p, a, b, c):
        return cross(a, b, p) >= 0 and cross(b, c, p) >= 0 and cross(c, a, p) >= 0

    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = pts[i0], pts[i1], pts[i2]
            if cross(a, b, c) <= 1e-12:
                continue
            if any(inside(pts[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            out.append((a, b, c))
            idx.pop(k)
            break
        else:
            break
    if len(idx) == 3:
        out.append(tuple(pts[i] for i in idx))
    return out


# =====================================================================================================
# Part layout (rig space: +Z forward, +Y up, +X = the dino's left). Node origins are the hinges.
HIP_L = np.array([0.072, 0.30, -0.04])
HIP_R = HIP_L * [-1, 1, 1]
SHOULDER_L = np.array([0.058, 0.395, 0.115])
SHOULDER_R = SHOULDER_L * [-1, 1, 1]
NECK = np.array([0.0, 0.485, 0.135])

BELLY_SEGS = {3, 4, 5}  # ring segments on the ventral side -> cream


def body_color(k, i):
    if k == -1:
        return GREEN
    return CREAM if k in BELLY_SEGS else GREEN


def build_body():
    m = Mesh()
    spine = [
        ((0, 0.19, -0.37), 0.006, 0.008, 0.008),
        ((0, 0.215, -0.29), 0.024, 0.026, 0.022),
        ((0, 0.25, -0.20), 0.048, 0.045, 0.04),
        ((0, 0.29, -0.11), 0.074, 0.068, 0.062),
        ((0, 0.325, -0.03), 0.088, 0.084, 0.084),
        ((0, 0.355, 0.045), 0.086, 0.084, 0.086),
        ((0, 0.405, 0.10), 0.07, 0.068, 0.066),
        ((0, 0.45, 0.125), 0.056, 0.05, 0.052),
        ((0, 0.495, 0.135), 0.05, 0.045, 0.046),
    ]
    m.loft(spine, body_color)

    # dorsal paper ridge: small cream-edged spikes along the back and tail
    for z, y, h in ((-0.30, 0.235, 0.02), (-0.22, 0.288, 0.025), (-0.15, 0.335, 0.026)):
        m.prism([(z - 0.025, y), (z + 0.025, y + 0.01), (z - 0.005, y + h + 0.01)], -0.006, 0.006, GREEN_D, CREAM)

    # bandana round the neck + a knotted flap hanging over the chest
    band = [((0, 0.418, 0.112), 0.074, 0.072, 0.07), ((0, 0.445, 0.122), 0.064, 0.062, 0.062)]
    m.loft(band, lambda k, i: ORANGE, cap_start=False, cap_end=False)
    m.prism([(0.17, 0.44), (0.198, 0.405), (0.175, 0.355), (0.16, 0.41)], -0.035, 0.035, ORANGE, lin('#c4521d'))

    # chest strap (around the torso) and belt (round the belly), brown with gold buckles
    for z, w, hgt in ((-0.05, 0.093, 0.088), (0.03, 0.093, 0.09)):
        y = 0.316 if z < 0 else 0.345
        m.loft([((0, y, z - 0.011), w, hgt, hgt), ((0, y, z + 0.011), w, hgt, hgt)], lambda k, i: BROWN, cap_start=False, cap_end=False)
    m.box((0.093, 0.32, -0.05), (0.008, 0.03, 0.03), {'+x': GOLD, '-x': GOLD, '+y': GOLD, '-y': GOLD, '+z': GOLD, '-z': GOLD})
    m.box((0.093, 0.32, -0.05), (0.01, 0.016, 0.016), BROWN)
    m.box((-0.093, 0.35, 0.03), (0.008, 0.03, 0.03), GOLD)
    m.box((-0.093, 0.35, 0.03), (0.01, 0.016, 0.016), BROWN)

    # boombox on the back, tilted nose-up like a rucksack
    R = rot_x(-14)
    bc = np.array([0.0, 0.455, -0.075])
    W, H, L = 0.082, 0.10, 0.175
    m.box(bc, (W, H, L), {'+x': DARK, '-x': DARK, '+y': CREAM, '-y': DARK, '+z': CREAM, '-z': CREAM}, R=R)
    P = lambda x, y, z: bc + R @ np.array([x, y, z])
    for sx in (1, -1):
        face = sx * W / 2
        # cream frame strip round the side panel
        m.box(P(sx * (W / 2 + 0.0015), H / 2 - 0.008, 0), (0.003, 0.012, L - 0.004), CREAM, R=R)
        m.box(P(sx * (W / 2 + 0.0015), -H / 2 + 0.006, 0), (0.003, 0.008, L - 0.004), CREAM, R=R)
        for zz in (-0.047, 0.047):
            c = P(face, -0.008, zz)
            m.disc(c, 0, sx, 0.034, 0.003, CREAM, R=R)
            m.disc(P(face + sx * 0.003, -0.008, zz), 0, sx, 0.026, 0.003, DARK2, R=R)
            m.disc(P(face + sx * 0.006, -0.008, zz), 0, sx, 0.009, 0.003, GREY, R=R)
        # cassette deck between the speakers (glows at night)
        m.box(P(face + sx * 0.002, -0.006, 0), (0.004, 0.034, 0.03), CREAM, R=R)
        m.box(P(face + sx * 0.004, -0.004, 0), (0.003, 0.018, 0.022), GLOW, R=R, mat='glow')
        # tuner strip + orange keys
        m.box(P(face + sx * 0.002, 0.032, 0), (0.004, 0.012, 0.11), CREAM, R=R)
        m.box(P(face + sx * 0.004, 0.032, 0), (0.003, 0.005, 0.08), DARK2, R=R)
        for zz in (-0.012, 0, 0.012):
            m.box(P(face + sx * 0.003, -0.036, zz), (0.006, 0.01, 0.009), ORANGE, R=R)
    # orange carry handle on top
    for zz in (-0.06, 0.06):
        m.box(P(0, H / 2 + 0.022, zz), (0.014, 0.044, 0.012), ORANGE, R=R)
    m.box(P(0, H / 2 + 0.044, 0), (0.016, 0.012, 0.132), ORANGE, R=R)
    # antenna with an orange tip
    m.box(P(0.03, H / 2 + 0.07, -0.075), (0.005, 0.14, 0.005), CREAM, R=R @ rot_x(-18))
    tip = P(0.03, H / 2, -0.075) + (R @ rot_x(-18)) @ np.array([0, 0.145, 0])
    m.box(tip, (0.012, 0.012, 0.012), ORANGE, R=R)
    # shoulder straps holding the box
    for sx in (1, -1):
        m.box(P(sx * 0.035, -H / 2 - 0.02, 0.03), (0.008, 0.06, 0.016), BROWN, R=R)
    return m


def build_head():
    m = Mesh()
    skull = [
        ((0, 0.045, -0.035), 0.048, 0.05, 0.035),
        ((0, 0.055, 0.02), 0.058, 0.058, 0.028),
        ((0, 0.058, 0.09), 0.052, 0.042, 0.018),
        ((0, 0.052, 0.165), 0.042, 0.03, 0.012),
        ((0, 0.048, 0.195), 0.034, 0.02, 0.01),
    ]
    m.loft(skull, lambda k, i: CREAM if k in BELLY_SEGS or k == -1 and i > 0 else GREEN)
    jaw = [
        ((0, 0.012, -0.005), 0.046, 0.02, 0.02),
        ((0, -0.006, 0.08), 0.04, 0.016, 0.015),
        ((0, -0.026, 0.16), 0.032, 0.012, 0.01),
    ]
    m.loft(jaw, lambda k, i: GREEN if k in BELLY_SEGS else CREAM)
    # mouth inside: red card between the jaws, a darker throat
    m.prism([(-0.01, 0.04), (0.185, 0.04), (0.16, -0.016), (-0.005, 0.016)], -0.03, 0.03, RED, RED_D)
    # teeth: little cream paper cones
    for z in (0.05, 0.085, 0.12, 0.155, 0.183):
        for sx in (1, -1):
            xu = sx * 0.031 * (1 - (z - 0.05) * 0.9)
            m.cone((xu, 0.037, z), (xu, 0.012, z + 0.004), 0.008, CREAM)
    for z in (0.06, 0.1, 0.14):
        for sx in (1, -1):
            yl = 0.0 - (z * 0.18)
            xl = sx * 0.028 * (1 - (z - 0.06) * 0.9)
            m.cone((xl, yl + 0.006, z), (xl, yl + 0.03, z - 0.002), 0.007, CREAM)
    # eyes, brows, nostrils
    for sx in (1, -1):
        m.box((sx * 0.055, 0.075, 0.035), (0.008, 0.016, 0.02), EYE)
        m.box((sx * 0.05, 0.1, 0.035), (0.016, 0.012, 0.05), GREEN_D, R=rot_z(sx * 18))
        m.box((sx * 0.016, 0.07, 0.196), (0.008, 0.006, 0.006), EYE)
    return m


def build_leg(sx):
    m = Mesh()
    path = [
        ((0, 0.03, -0.005), 0.038, 0.062, 0.05),
        ((0, -0.06, 0.03), 0.034, 0.052, 0.042),
        ((0, -0.14, 0.03), 0.026, 0.032, 0.03),
        ((0, -0.22, -0.02), 0.019, 0.022, 0.02),
        ((0, -0.275, -0.025), 0.018, 0.02, 0.018),
    ]
    m.loft(path, lambda k, i: CREAM if k == 4 and i < 2 else GREEN)
    # foot: cut-out sole with three cream claws
    m.prism([(-0.045, -0.30), (0.075, -0.30), (0.082, -0.285), (0.02, -0.262), (-0.04, -0.265)], -0.03, 0.03, GREEN, GREEN_D)
    for x in (-0.02, 0.0, 0.02):
        m.cone((x, -0.292, 0.072), (x, -0.298, 0.104), 0.009, CREAM)
    return m


def build_arm(sx, gun=False):
    m = Mesh()
    path = [
        ((0, 0.0, 0.0), 0.014, 0.016, 0.014),
        ((sx * 0.004, -0.03, 0.03), 0.012, 0.013, 0.012),
        ((sx * 0.006, -0.042, 0.06), 0.011, 0.012, 0.011),
    ]
    m.loft(path, lambda k, i: CREAM if k in BELLY_SEGS else GREEN)
    for dx in (-0.006, 0.006):
        m.cone((sx * 0.006 + dx, -0.045, 0.064), (sx * 0.006 + dx, -0.058, 0.08), 0.005, CREAM)
    if gun:
        g = np.array([sx * 0.006, -0.05, 0.07])
        # chunky toy pistol: dark slide, brown grip, orange trigger, pointing forward
        m.box(g + [0, 0.012, 0.022], (0.016, 0.02, 0.07), {'+x': DARK, '-x': DARK, '+y': GREY, '-y': DARK, '+z': DARK2, '-z': DARK})
        m.box(g + [0, -0.012, -0.002], (0.014, 0.036, 0.02), DARK, R=rot_x(-14))
        m.box(g + [0, 0.0, 0.016], (0.006, 0.01, 0.006), ORANGE)
        m.disc(g + [0, 0.012, 0.057], 2, 1, 0.005, 0.0015, EYE)
    return m


def build_base():
    m = Mesh()
    poly = [(0.13 * math.cos(a), 0.13 * math.sin(a)) for a in [2 * math.pi * (i + 0.5) / 8 for i in range(8)]]
    # flat octagon tab, 5 mm thick
    top = [np.array([x, 0.005, z]) for x, z in poly]
    bot = [np.array([x, 0.0, z]) for x, z in poly]
    c_top, c_bot = np.array([0, 0.005, 0]), np.array([0, 0, 0])
    for i in range(8):
        j = (i + 1) % 8
        m.tri(c_top, top[i], top[j], CREAM, inside=c_bot)
        m.tri(c_bot, bot[j], bot[i], CREAM, inside=c_top)
        m.quad(bot[i], bot[j], top[j], top[i], lin('#c8a067'), inside=(0, 0.0025, 0))
    return m


# =====================================================================================================
def write_glb(parts, path):
    """parts: list of (name, Mesh, translation, children_names, parent)."""
    bin_ = bytearray()
    views, accessors, meshes = [], [], []

    def add_view(data, target=None):
        while len(bin_) % 4:
            bin_.append(0)
        off = len(bin_)
        bin_.extend(data)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def add_acc(arr, ctype, typ, normalized=False, minmax=False, target=34962):
        vi = add_view(arr.tobytes(), target)
        a = {'bufferView': vi, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = arr.min(0).tolist()
            a['max'] = arr.max(0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    mesh_index = {}
    for name, mesh, *_ in parts:
        prims = []
        for mat_i, mat in enumerate(('paper', 'glow')):
            tris = mesh.tris[mat]
            if not tris:
                continue
            P, N, C = [], [], []
            for a, b, c, col in tris:
                n = np.cross(b - a, c - a)
                n /= np.linalg.norm(n)
                for p in (a, b, c):
                    P.append(p)
                    N.append(n)
                    C.append(list(col) + [1.0])
            P = np.array(P, np.float32)
            N = np.array(N, np.float32)
            UV0 = np.stack([(P[:, 0] + P[:, 2]) * 4.0, -P[:, 1] * 4.0], 1).astype(np.float32)
            UV1 = np.full((len(P), 2), -1.0, np.float32)
            Cq = np.clip(np.round(np.array(C) * 65535), 0, 65535).astype(np.uint16)
            idx = np.arange(len(P), dtype=np.uint16 if len(P) < 65535 else np.uint32)
            prims.append({
                'attributes': {
                    'POSITION': add_acc(P, 5126, 'VEC3', minmax=True),
                    'NORMAL': add_acc(N, 5126, 'VEC3'),
                    'TEXCOORD_0': add_acc(UV0, 5126, 'VEC2'),
                    'TEXCOORD_1': add_acc(UV1, 5126, 'VEC2'),
                    'COLOR_0': add_acc(Cq, 5123, 'VEC4', normalized=True),
                },
                'indices': add_acc(idx, 5123 if idx.dtype == np.uint16 else 5125, 'SCALAR', target=34963),
                'material': mat_i,
            })
        meshes.append({'name': 'traveller__' + name, 'primitives': prims})
        mesh_index[name] = len(meshes) - 1

    names = [p[0] for p in parts]
    nodes = []
    for name, mesh, t, children, _parent in parts:
        n = {'name': 'traveller__' + name, 'mesh': mesh_index[name], 'translation': [float(x) for x in t], 'rotation': [0, 0, 0, 1]}
        if children:
            n['children'] = [names.index(c) for c in children]
        nodes.append(n)
    roots = [names.index(p[0]) for p in parts if p[4] is None]
    nodes.append({'name': 'traveller', 'children': roots, 'extras': {'model': 'traveller', 'height': 0.6, 'variant': 'dino'}, 'translation': [0, 0, 0], 'rotation': [0, 0, 0, 1]})
    gltf = {
        'asset': {'version': '2.0', 'generator': 'Papertrails tools/dino/build_dino.py'},
        'extensionsUsed': ['KHR_materials_emissive_strength', 'KHR_materials_specular'],
        'scene': 0,
        'scenes': [{'name': 'Scene', 'nodes': [len(nodes) - 1]}],
        'nodes': nodes,
        'meshes': meshes,
        'materials': [
            {'name': 'paper', 'doubleSided': True, 'extensions': {'KHR_materials_specular': {'specularFactor': 0.2}},
             'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.95}},
            {'name': 'glow', 'doubleSided': True, 'emissiveFactor': GLOW, 'extensions': {'KHR_materials_emissive_strength': {'emissiveStrength': 3}},
             'pbrMetallicRoughness': {'baseColorFactor': GLOW + [1], 'metallicFactor': 0, 'roughnessFactor': 0.5}},
        ],
        'buffers': [{'byteLength': 0}],
        'bufferViews': views,
        'accessors': accessors,
    }
    while len(bin_) % 4:
        bin_.append(0)
    gltf['buffers'][0]['byteLength'] = len(bin_)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_))


def main():
    body = build_body()
    head = build_head()
    arm_l, arm_r = build_arm(1), build_arm(-1, gun=True)
    leg_l, leg_r = build_leg(1), build_leg(-1)
    # head/arm/leg meshes are authored around their own hinge already (local coordinates).
    parts = [
        ('base_tab', build_base(), (0, 0, 0), [], None),
        ('arm_l', arm_l, SHOULDER_L, [], 'body'),
        ('arm_r', arm_r, SHOULDER_R, [], 'body'),
        ('head', head, NECK, [], 'body'),
        ('body', body, (0, 0, 0), ['arm_l', 'arm_r', 'head'], None),
        ('leg_l', leg_l, HIP_L, [], None),
        ('leg_r', leg_r, HIP_R, [], None),
    ]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_glb(parts, OUT)
    tri = sum(len(m.tris[k]) for _, m, *_ in parts for k in m.tris)
    print('wrote', os.path.normpath(OUT), os.path.getsize(OUT), 'bytes,', tri, 'triangles')


if __name__ == '__main__':
    main()

"""Put repainted PNGs (from tools/textures/export.py) back into the game's atlases.

    python3 tools/textures/import.py IN_DIR

Every file found in IN_DIR/1-Welt, 2-Tiere, 3-Symbole, 4-Papier-und-Drucke replaces its rect in the atlas; missing
files keep the original picture. A file of another size is scaled to the rect. Transparent pixels stay transparent:
the shape of a world card (its outline in atlas.json) does not change, so paint inside the existing silhouette.
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'textures')


def unchanged(dst, src_path, x, y, w, h):
    """True when the file is still the exported original (then the atlas pixels are left alone)."""
    im = Image.open(src_path).convert('RGBA')
    return im.size == (w, h) and im.tobytes() == dst.crop((x, y, x + w, y + h)).tobytes()


def paste(dst, src_path, x, y, w, h, keep_alpha=False):
    if unchanged(dst, src_path, x, y, w, h):
        return 0
    im = Image.open(src_path).convert('RGBA')
    if im.size != (w, h):
        im = im.resize((w, h), Image.LANCZOS)
    if keep_alpha:  # world cards: the silhouette is cut from the outline, keep the original alpha
        a = dst.crop((x, y, x + w, y + h)).getchannel('A')
        im.putalpha(a)
    dst.paste(im, (x, y))
    return 1


def main(src):
    T = lambda *p: os.path.join(ROOT, *p)
    S = lambda *p: os.path.join(src, *p)
    n = 0
    w1 = 0
    atlas = Image.open(T('art', 'atlas.webp')).convert('RGBA')
    for name, sp in json.load(open(T('art', 'atlas.json')))['sprites'].items():
        f = S('1-Welt', name + '.png')
        if os.path.exists(f):
            k = paste(atlas, f, *sp['rect'], keep_alpha=True); n += k; w1 += k
    if w1:
        atlas.save(T('art', 'atlas.webp'), 'WEBP', quality=92, method=6)

    w2 = 0
    img = Image.open(T('art', 'animals.png')).convert('RGBA')
    for name, a in json.load(open(T('art', 'animals.json')))['animals'].items():
        for pose, r in a['poses'].items():
            f = S('2-Tiere', f'{name}__{pose}.png')
            if os.path.exists(f):
                k = paste(img, f, r['x'], r['y'], r['w'], r['h']); n += k; w2 += k
    if w2:
        img.save(T('art', 'animals.png'), optimize=True)

    w3 = 0
    img = Image.open(T('art', 'game_icons.png')).convert('RGBA')
    for name, r in json.load(open(T('art', 'game_icons.json')))['icons'].items():
        f = S('3-Symbole', name + '.png')
        if os.path.exists(f):
            k = paste(img, f, r['x'], r['y'], r['w'], r['h']); n += k; w3 += k
    if w3:
        img.save(T('art', 'game_icons.png'), optimize=True)

    man = json.load(open(T('manifest.json')))
    w4 = 0
    pa = Image.open(T('paper', 'print_atlas.png')).convert('RGBA')
    pad = man['printAtlas']['pad']
    for name, c in man['printAtlas']['cells'].items():
        f = S('4-Papier-und-Drucke', 'muster_' + name + '.png')
        if not os.path.exists(f):
            continue
        x, y, w, h = c['px']
        if unchanged(pa, f, x, y, w, h):
            continue
        w4 += 1
        im = Image.open(f).convert('RGBA').resize((w, h), Image.LANCZOS)
        # the pattern tiles: rebuild the wrapped gutter around the cell
        big = Image.new('RGBA', (w * 3, h * 3))
        for i in range(3):
            for j in range(3):
                big.paste(im, (i * w, j * h))
        pa.paste(big.crop((w - pad, h - pad, 2 * w + pad, 2 * h + pad)), (x - pad, y - pad)); n += 1
    if w4:
        pa.save(T('paper', 'print_atlas.png'), optimize=True)
    f = S('4-Papier-und-Drucke', 'tisch_holz.png')
    if os.path.exists(f) and Image.open(f).convert('RGB').tobytes() != Image.open(T('paper', 'table_wood.jpg')).convert('RGB').tobytes():
        Image.open(f).convert('RGB').resize((512, 512), Image.LANCZOS).save(T('paper', 'table_wood.jpg'), quality=90); n += 1
    print('replaced', n, 'repainted pictures from', src)


if __name__ == '__main__':
    main(sys.argv[1])

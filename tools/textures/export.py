"""Cut every picture the game paints with into single PNGs, for repainting.

    python3 tools/textures/export.py OUT_DIR

Writes OUT_DIR/1-Welt, 2-Tiere, 3-Symbole, 4-Papier-und-Drucke (one PNG per sprite / pose / icon / print cell, at
its exact pixel size) plus an overview sheet. tools/textures/import.py puts repainted files back into the atlases.
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'textures')


def main(out):
    T = lambda *p: os.path.join(ROOT, *p)
    os.makedirs(out, exist_ok=True)
    n = 0
    # 1. world sprites (trees, houses, bushes, rocks ...)
    d = os.path.join(out, '1-Welt'); os.makedirs(d, exist_ok=True)
    atlas = Image.open(T('art', 'atlas.webp')).convert('RGBA')
    for name, sp in json.load(open(T('art', 'atlas.json')))['sprites'].items():
        x, y, w, h = sp['rect']
        atlas.crop((x, y, x + w, y + h)).save(os.path.join(d, name + '.png')); n += 1
    # 2. animals: one file per pose
    d = os.path.join(out, '2-Tiere'); os.makedirs(d, exist_ok=True)
    img = Image.open(T('art', 'animals.png')).convert('RGBA')
    for name, a in json.load(open(T('art', 'animals.json')))['animals'].items():
        for pose, r in a['poses'].items():
            img.crop((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])).save(os.path.join(d, f'{name}__{pose}.png')); n += 1
    # 3. map stamps / scrap icons
    d = os.path.join(out, '3-Symbole'); os.makedirs(d, exist_ok=True)
    img = Image.open(T('art', 'game_icons.png')).convert('RGBA')
    for name, r in json.load(open(T('art', 'game_icons.json')))['icons'].items():
        img.crop((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])).save(os.path.join(d, name + '.png')); n += 1
    # 4. printed patterns (roof shingles, bricks, wood, grass ...) and the table
    d = os.path.join(out, '4-Papier-und-Drucke'); os.makedirs(d, exist_ok=True)
    man = json.load(open(T('manifest.json')))
    pa = Image.open(T('paper', 'print_atlas.png')).convert('RGBA')
    for name, c in man['printAtlas']['cells'].items():
        x, y, w, h = c['px']
        pa.crop((x, y, x + w, y + h)).save(os.path.join(d, 'muster_' + name + '.png')); n += 1
    Image.open(T('paper', 'table_wood.jpg')).save(os.path.join(d, 'tisch_holz.png')); n += 1
    # overview of the world atlas
    atlas.resize((2048, 2048), Image.LANCZOS).save(os.path.join(out, 'Uebersicht-Welt.png'))
    print('exported', n, 'pictures to', out)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'texturen-export')

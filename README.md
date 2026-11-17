# my-handwriting - your own handwriting for any text

Teach the computer your handwriting: write every character a few times with a pen, finger or mouse.
Afterwards any text can be written in *your* handwriting - as PNG, SVG or PDF, directly in the
browser, or by Claude with the skill `/my-handwriting`. Several samples per character are mixed at
random, with a little natural variation, so the result does not look like a font.

- **Runs completely offline** - one web page, no server, no account. Your samples never leave the device.
- **Pen, finger or mouse** - made for pen laptops and tablets (Samsung S Pen, Surface Pen, Apple
  Pencil): a hovering pen is detected before it touches the screen, the resting hand is ignored,
  the eraser end and the side button wipe strokes, buttons get bigger for touch.
- **Faint guide letter** (on by default, adjustable) shows how the normal character looks.
- **6 languages** for the interface and the special letters: English, Deutsch, Français, Español,
  Italiano, Polski. Each language's letters (ä ß ẞ, é ç œ, ñ ¿ ¡, à ì ò, ł ż …) can be written.
- **Never a gap:** characters you have not written are composed from your letters (é = your e +
  accent, ł, ¿, ½ …) or drawn in a neat *standard handwriting* fitted to your size and slant.
- **Write text** dialog: paper (blank, lined, squared), A4/A5/US Letter or fitted image, ink colour,
  alignment, natural variation, fractions like `[[3/4]]`, simple Markdown (`# heading`, `- list`).
- **Claude skill** `/my-handwriting`: Claude writes letters, cards, notes or summaries as a PDF in
  your handwriting (Python, standard library only).

## Quick start

1. Open **`index.html`** (double-click) - or the online version, if the repository owner enabled
   GitHub Pages (`https://<user>.github.io/my-handwriting/`). The online version can be installed as
   an app and works offline afterwards.
2. A short introduction asks for the interface language, the languages you write, how Claude should
   write your documents, and how many samples you want (3 = quick test, 10 = most natural).
3. Write each character on the area. **Enter** saves, **Ctrl+Z** undoes, **Esc** clears, **V**
   toggles the guide letter, **← →** change the character.
4. **Write text** → type, choose paper and colour → download PNG, SVG or PDF.
5. **Export** saves your samples as `my-handwriting-glyphs-DATE.json` - keep this file safe, it is
   your handwriting. **Import** brings it back on another device (duplicates are detected).

Time needed: about 15 minutes for 3 samples per character, about an hour for 10.

## Use with Claude

```bash
# in the project folder (Windows: python or py, macOS/Linux: python3)
python skill/my-handwriting/scripts/my_handwriting.py install --glyphs ~/Downloads/my-handwriting-glyphs-2026-11-17.json
```

This copies the skill to `~/.claude/skills/my-handwriting/` together with your file. Then, in Claude Code:

```
/my-handwriting write a thank-you letter to my aunt as a PDF
```

For the Claude app (claude.ai, Desktop): `... my_handwriting.py package --glyphs <file>` creates
`my-handwriting-skill.zip`, which you upload under Settings → Capabilities → Skills. The ZIP
contains your handwriting - keep it private.

Claude first runs `my_handwriting.py info` (your defaults from the app: language, paper, size,
colour, page) and then renders the text with `render --markdown`. Details: [skill/my-handwriting/SKILL.md](skill/my-handwriting/SKILL.md).

## Command line

```bash
S=skill/my-handwriting/scripts/my_handwriting.py
python $S info                                     # which file, languages, defaults, missing characters
python $S check                                    # coverage and unusual samples
python $S render --text "Hello world!" --out hello.pdf
python $S render --input letter.md --markdown --paper lined --out letter.pdf
python $S render --input note.txt --out note.png --transparent        # PNG needs: pip install pillow
python $S sheet --out overview.pdf                 # all your samples on one sheet
```

The sample file is found automatically: `--glyphs`, else `$MY_HANDWRITING_GLYPHS`, else
`data/glyphs.json` in the skill folder, else the newest `my-handwriting-glyphs-*.json` in your
Downloads folder. Messages are English or German (`--lang de`). All options: `render --help`.

## Devices

| Device | Status |
|---|---|
| Windows 10 / 11 - Edge, Chrome, Firefox (mouse, touch, pen incl. eraser and side button) | tested in Chromium; pen/touch with simulated input |
| Pen laptops (Galaxy Book 360 + S Pen, Surface) | supported (hover detection, palm rejection); not yet tried on a real device |
| Android tablets / phones (Chrome) | layout tested at 375 px; real devices not yet |
| iPad / iPhone (Safari, Apple Pencil) | should work (Pointer Events), not tested yet - see storage note |
| Python script / skill | Windows, macOS, Linux, Python 3.8+ (PNG needs Pillow) |

**Storage:** samples live in the browser (IndexedDB, plus a copy in localStorage). Private windows,
clearing browser data, or Safari's rule that deletes data of websites not used for 7 days can remove
them. **Export regularly** - the app reminds you.

## Use it fairly

This tool imitates **your own** handwriting for your own texts (letters, notes, cards, mock-ups).
Do not use it to forge signatures or documents, or where handwriting is required (exams,
contracts). Treat your sample file like a password: anyone who has it can write "in your hand".
That is also why sample files are excluded from Git (`.gitignore`).

## How it compares

- **Font builders** (Calligraphr, [draw-your-font](https://github.com/danilo-znamerovszkij/draw-your-font))
  turn one sample per character into a font file. You can then use it in any program, but every
  "e" looks identical.
- **Neural handwriting synthesis** (e.g. [handwriting-synthesis](https://github.com/sjvasquez/handwriting-synthesis))
  generates a style; it is not your real letters.
- **my-handwriting** keeps several real samples per character, captured live with a pen, varies
  them like real writing, composes missing characters, runs fully offline and writes vector PDF/SVG
  directly - also for Claude. It does not produce a font file.

## Data format

`format: "my-handwriting-glyphs"`, `version: 1` (files named `handschrift-glyphs` from the project's
earlier private versions are read too). Coordinates are integers ×1000 in units of the capital
height (baseline = 0, top line = 1000). Every sample has a unique `id`, so merging never creates
duplicates. Details: [docs/CONCEPT.md](docs/CONCEPT.md).

## Development

No build step, no dependencies: classic `<script>` files in `js/`, one stylesheet. Tests:

```bash
node tests/i18n_test.js                     # every language has every text
python tests/make_fixture.py out/fx.json    # synthetic samples (needs Pillow), never real handwriting
node tests/render_test.js out/fx.json       # browser typesetter, standard handwriting, Markdown, SVG, PDF
python tests/py_test.py                     # Python script + skill, same rules as the web app
python tools/build_fallback_font.py         # rebuild the standard handwriting (after changing it)
```

Local server: `python -m http.server 5311 --bind 127.0.0.1` and open <http://127.0.0.1:5311/>.
Translations: one file per language in `js/lang/` - copy `en.js`, translate, add it to `index.html`,
`sw.js` and `js/charsets.js` (special letters). See [docs/CONCEPT.md](docs/CONCEPT.md).

## License

[MIT](LICENSE). The standard handwriting is converted from the Hershey fonts - see [NOTICE.md](NOTICE.md).

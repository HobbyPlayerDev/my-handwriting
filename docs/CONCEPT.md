# Concept: my-handwriting

## Goal
Anyone can teach Claude (and the app) their own handwriting in about an hour and then write any text in it -
without installing anything, without an account; the handwriting only leaves their device when they
upload the skill ZIP to their own Claude account.
Claude can use the same handwriting through the skill `/my-handwriting` to write whole documents.

## Who, what for
- Private use: letters, cards, notes, invitations, labels, images for slides or social media.
- Designers: handwritten elements as vector graphics (SVG/PDF).
- Not for: signatures, certificates, exams, anything that must be written "by hand" (stated in the
  help, the README and the skill).

## User flow
1. **Start** - introduction in 6 steps: interface language (English by default, browser language
   suggested) → how it works (+ privacy) → languages you write → Claude & documents (Claude's
   language, paper, size, colour, page, standard handwriting on/off) → practice (3/5/10 samples,
   guide letter) → writing tips. Can be repeated from the help ("?").
2. **Capture** - one character after the other: the character large with name and hint, the writing
   area with lines (top line, lowercase line, baseline, descender) and the **faint guide letter**
   (15 % opacity, 4-40 %, key V). Below: the samples so far (unusual ones orange). The overview lists
   all groups with progress; own characters are added with the field at its bottom.
3. **Save** - automatic in the browser (IndexedDB + copy in localStorage), reminder after 150 new
   samples, "Export" as JSON file, "Import" (merge without duplicates, or replace).
4. **Write** - dialog: text, size, paper, page, colour, alignment, variation, Markdown, standard
   handwriting on/off, transparent background, shuffle; download PNG (200 dpi), SVG, PDF (vector,
   compressed).
5. **Claude** - `install` copies the skill and the exported file to `~/.claude/skills/my-handwriting/`;
   `/my-handwriting …` → Claude writes Markdown, renders a PDF, reports characters it had to replace.

## Several handwritings
Each handwriting (person or style) has its own samples and settings (`profiles` + `state:<id>` in
IndexedDB). Switch with the button next to the logo; create, rename, delete in the settings (delete
and "reset everything" can be undone until the page is closed). Exports carry the `name`; the skill
keeps the default handwriting in `data/glyphs.json` and others in `data/glyphs-<name>.json`
(`--profile`).

## Getting it into Claude
"Use in Claude" builds `my-handwriting-skill.zip` in the browser (`js/zip.js` + `js/skill-bundle.js`,
the generated copy of `skill/my-handwriting/`) with the active handwriting as `data/glyphs.json`
(optionally all). There is **one** way in the interface, because it works for everyone: upload the
ZIP in the Claude app (claude.ai → Customize → Skills → + → Upload a skill; needs code execution,
works on the free plan). Skills uploaded there are available in every chat (web, desktop, phone) and
are synced to Claude Code. Developers can still install locally with `my_handwriting.py install`
(README). A web page cannot write into Claude directly, so the upload is always one step by the user.

## Parts

| Part | File | Job |
|---|---|---|
| Page | `index.html`, `css/app.css` | interface, no inline scripts |
| Translations | `js/i18n.js`, `js/lang/*.js` | core + one table per language, `data-i18n*` attributes, `I18N.t(key, vars)` |
| Character sets | `js/charsets.js` | base groups + special letters per language (same in Python) |
| Standard handwriting | `js/fallback-font.js` (generated) | Hershey Roman Simplex + hand-made extras, built by `tools/build_fallback_font.py` |
| Typesetter | `js/render.js` | load samples, smooth, replacements, standard handwriting, kerning, Markdown, pages, PNG/SVG/PDF |
| App | `js/app.js` | state, writing area, pen handling, wizard, export/import, dialogs |
| Offline | `sw.js`, `manifest.webmanifest`, `icon.svg` | installable over https (GitHub Pages) |
| Skill | `skill/my-handwriting/` | `SKILL.md`, `scripts/my_handwriting.py` (render/info/check/sheet/install/package), `scripts/fallback_font.json` |
| Tests | `tests/` | translations, typesetter, script, JS ↔ Python consistency |

## Data format (`my-handwriting-glyphs`, version 1)
```json
{ "format": "my-handwriting-glyphs", "version": 1, "app": "my-handwriting 1.0.0", "exported": "…",
  "metrics": { "scale": 1000, "cap": 1, "xheight": 0.6, "baseline": 0, "descender": -0.4,
               "boxTop": 1.45, "boxBottom": -0.6, "boxWidth": 2.2, "penWidth": 0.05 },
  "settings": { "target": 10, "custom": "π✓", "scripts": ["en", "de"], "lang": "de",
                "claude": { "lang": "de", "paper": "lined", "size": 6, "color": "blue", "page": "a4", "fallback": "font",
                            "realism": true, "align": "left", "variation": 1 } },
  "glyphs": { "A": [ { "id": "…uuid…", "created": 1763390000000, "dev": "pen",
                       "strokes": [[x, y, x, y, …], …] } ] } }
```
- Coordinates: integers × 1000, unit = capital height, baseline 0, y up.
- Every sample has a unique `id` → merging without duplicates.
- Rule: **only extend** (new fields optional, missing = old default). Files without `scripts` count
  as German (first private version). The old format name `handschrift-glyphs` is accepted. A newer
  format version is refused with a clear message, never read wrongly.

## How the writing is made (typesetter)
1. Every sample: resample evenly (0.01), smooth twice, Douglas-Peucker (0.002) against file size.
2. Outliers per character (height/width/position far from the median) are avoided; size/position are
   pulled a little towards the median (consistency 0.6).
3. One random sample per character, but not the same as the last two times.
4. Variation: slight scaling (±3 %), rotation (±1.3°), height offset, per line a slope and a wave,
   varying spaces - all from one seed, so results are reproducible.
5. Kerning by profiles (bands of 0.08): characters move as close as their shapes allow.
6. **Characters without samples** - two passes:
   - pass 1, own samples only: `FALLBACKS` (same list in JS and Python: quotes, dashes,
     superscripts, fractions ½, ¿ = turned ?, ł = l + slanted stroke …), accents from the Unicode
     decomposition (é = e + acute, ą = a + ogonek …);
   - pass 2, if something is still missing: the character from the standard handwriting, or a
     composition with standard-handwriting parts. Approximations such as € → "EUR" or ß → "ss" are
     only used without the standard handwriting (`APPROX`).
   - The standard handwriting is scaled to the writer's capital height and x-height, sheared to their
     slant (measured from long vertical strokes) and varied like a sample. Without it (setting off,
     `--no-font`) missing characters become red boxes; a scaled capital then stands in for a missing
     small letter.
7. Markdown (optional): `#`/`##`/`###` headings (bigger, level 1 underlined with the own hyphen),
   `-`/`*`/`+` and `1.`/`a)` lists with hanging indent, `>` indent, `---` hand-drawn rule; `**`, `__`
   and backticks are removed. `[[pagebreak]]` always starts a new page, `[[a/b]]` is a fraction.
8. Line breaks at word boundaries, overlong words broken hard, pages by line count.

## Devices and input
- Pointer Events for mouse, finger, pen; `getCoalescedEvents` for smooth strokes.
- Palm rejection: as soon as a pen was seen (also hovering, before it touches), touches are ignored;
  remembered per device (localStorage), "Pen detected" badge allows fingers again. A pen that comes
  down while a touch is drawing replaces that touch stroke.
- Pen eraser (`button 5` / `buttons & 32`) and side button (`button 2` / `buttons & 2`, S Pen on
  Windows) erase whole strokes; the context menu of press-and-hold is suppressed on the area.
- Undo also restores clearing and erasing (history of snapshots, max. 60).
- Bigger buttons once a finger/pen was used last (class `touch-ui`; not `@media (pointer: coarse)`,
  which is wrong on touch laptops).
- The area adapts to the window (also rotating a 360° laptop), never in the middle of a stroke.

## Privacy and security
- No network access apart from loading the app's own files. No tracking, no external fonts.
- Samples are biometric-like personal data → `.gitignore` excludes them, the export dialog and the
  skill package warn.
- Deleting all data needs a second click and can be undone until the page is closed.
- Imported files are checked strictly (numbers only, known structure only).
- The skill never sends data anywhere; `install` keeps a `.bak` of a replaced file.

## Limits (honest)
- Joined-up cursive is not joined: letters stand alone (print letters look most real).
- Samples are only stored in the browser → without export they can get lost.
- Not yet checked on real devices: iPad/iPhone (Safari), Android tablets, Surface/Galaxy Book with pen.
- The standard handwriting is neat and upright-ish; it fits size and slant, but not the personal style.
- Multi-page PNG = several downloads.

## Ideas for later
- Joins between letters (ligatures "en", "ch" as own samples - the format already allows multi-character keys).
- Pen pressure as stroke width.
- Font export (OTF with alternates) for Word & co. - big effort.
- Several handwriting profiles ("neat" and "quick").
- Learn the standard handwriting's style from the user's letters (stroke endings, roundness).

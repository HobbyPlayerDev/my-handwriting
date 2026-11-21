---
name: my-handwriting
description: Writes documents in the user's own handwriting (PDF, PNG or SVG) from samples they captured in the my-handwriting app. Use when the user asks for something "in my handwriting", "handwritten", or invokes /my-handwriting - for example a letter, card, note, list or summary as a handwritten-looking PDF.
---

# my-handwriting

The skill is called **/my-handwriting**. It turns any text into the user's own handwriting. The user wrote every character a few
times in the my-handwriting web app and exported a file (`my-handwriting-glyphs-*.json`). The
script `scripts/my_handwriting.py` in this skill's folder (Python 3.8+, standard library only)
typesets the text with those samples: a random sample per character, natural variation, kerning,
fractions, accents. Characters the user has not written are drawn in a neat standard handwriting
that is fitted to their size and slant, so a document never has gaps.

Below, `SCRIPT` means `scripts/my_handwriting.py` inside this skill's folder (use the absolute path;
call it with `python` or `python3`, whichever exists).

## 1. Look first

Run `python SCRIPT info` and read the JSON:

- `ready: false` → there is no handwriting file yet. Tell the user, in their language, to open the
  app (index.html or the GitHub Pages address), write the characters, click **Use in Claude** and
  follow the steps there (it downloads this skill as a ZIP together with their handwriting).
  Alternatively: **Export**, then `python SCRIPT install --glyphs <exported file>`. Stop here.
- `claude.lang` → the language the user chose in the app. Always answer in it, unless the user
  asks for another language (`null` = the language the user writes in).
- `claude` → the user's document defaults, the same as in the app: `paper`, `size` (mm), `color`,
  `page`, `align`, `irregularity` (the app's slider in %, 50 = default; `variation` is the same as a
  number 0-2), `realism` ("look real": slight tremor, stretch and pen pressure) and `fallback`. The
  renderer already uses them; only pass options when the user asks for something else.
- `languages_missing` / `missing_basic` → characters without own samples. They will appear in the
  standard handwriting (unless `claude.fallback` is `box`, then as red boxes).
- `handwritings` → the handwritings stored in this skill (several people or styles). Without
  `--profile` the default one is used (`name` shows which). If the user names another one ("in
  Grandma's handwriting"), add `--profile "<name>"` to `info` and `render`; if it is unclear which
  one is meant and there are several, ask.

## 2. Write the text

Write the content the user asked for (letter, card, list, summary …) in plain text with simple
Markdown, and save it as a UTF-8 file, e.g. `letter.md`. Supported:

| Markdown | Result |
|---|---|
| `# Heading` | big heading, underlined by hand |
| `## Heading`, `### Heading` | smaller headings |
| `- item`, `* item` (indent 2 spaces to nest) | list with a dash |
| `1. item`, `a) item` | numbered list |
| `---` | hand-drawn line |
| `[[pagebreak]]` (own line) | new page |
| `[[3/4]]` | real stacked fraction |
| empty line | empty line (paragraph) |

Not available in handwriting: bold/italic (markers are removed), tables, images, links (write the
URL as text), colours inside the text. Turn tables into lists. Keep it natural: handwritten pages
hold less text than printed ones - about 18-22 lines of 6 mm writing on an A4 page.

## 3. Render

```
python SCRIPT render --input letter.md --markdown --out letter.pdf --json
```

Every setting of the app can be changed - but only when the user asks for it (in this message or
earlier in the chat; keep a change for the rest of the chat):

| The user says (examples) | Option |
|---|---|
| bigger / smaller writing | `--size 8` / `--size 4` (capital height in mm: 3.5 4 5 6 8 10 14 20) |
| blank / lined / squared paper | `--paper blank` / `lined` / `grid` |
| A5, US letter, landscape, just the text | `--page a5` / `letter`, `--landscape`, `--page auto` |
| in red, in pencil, a colour | `--color red` (blue black royal pencil red green or `#RRGGBB`) |
| centred, right-aligned | `--align center` / `right` |
| neater, more even / wilder, messier | `--irregularity 20` / `--irregularity 80` (0-100 %, 50 = default) |
| less real, cleaner | `--no-realism` (`--realism` switches it back on) |
| no standard handwriting | `--no-font` (red boxes for characters without samples) |
| transparent background | `--transparent` with `.png` or `.svg` |
| different look, "shuffle" | another `--seed N` (same seed = same result) |

Also: `.png`/`.svg` output (PNG needs Pillow). `python SCRIPT render --help` lists everything.

Where to save: the folder the user named, else the current working folder; in a sandbox with an
outputs folder (e.g. `/mnt/user-data/outputs/`) save it there so the user can download it.

## 4. Answer: settings first

Start your answer with the report's `settings_line`, exactly as it is, on its own line - it lists
every setting of this document in the words of the app and in the user's language (for example
`Einstellungen: Größe: 6 mm · Papier: Liniert · … · Unregelmäßigkeit: 50 % · Echt wirken lassen: an`).
If you answer in another language than `claude.lang`, translate the line. Then give the answer you
would give anyway, in the user's language (`claude.lang`).

The JSON report lists `files`, `pages`, `standard_handwriting` (characters drawn in the standard
handwriting) and `missing` (red boxes). Tell the user where the file is. If `standard_handwriting`
is not empty, mention it in one short sentence and suggest writing those characters in the app
(then export and `install` again). If the result should look different, render again with other
options or another `--seed`.

## Fair use

Only for the user's own texts. Do not imitate someone else's handwriting, never create or imitate
signatures, and do not produce documents meant to deceive (e.g. forged notes, homework or exams
that must be handwritten by the person). Politely refuse such requests.

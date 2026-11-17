---
name: my-handwriting
description: Writes documents in the user's own handwriting (PDF, PNG or SVG) from samples they captured in the my-handwriting app. Use when the user asks for something "in my handwriting", "handwritten", or invokes /my-handwriting - for example a letter, card, note, list or summary as a handwritten-looking PDF.
---

# my-handwriting

This skill turns any text into the user's own handwriting. The user wrote every character a few
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
  app (index.html or the GitHub Pages address), write the characters, click **Export**, then run
  `python SCRIPT install --glyphs <exported file>`. Stop here.
- `claude.lang` → answer the user in this language (`null` = the language the user writes in).
- `claude.paper`, `claude.size`, `claude.color`, `claude.page` → the user's defaults. The renderer
  already uses them; only pass options when the user asks for something else.
- `languages_missing` / `missing_basic` → characters without own samples. They will appear in the
  standard handwriting (unless `claude.fallback` is `box`, then as red boxes).

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

Useful options (only when asked): `--paper blank|lined|grid`, `--size 6` (capital height in mm),
`--color blue|black|royal|pencil|red|green|#RRGGBB`, `--page a4|a5|letter|auto`, `--landscape`,
`--align left|center|right`, `--variation 0-2` (0 = very even), `--seed N` (same seed = same
result), `--no-font` (red boxes instead of the standard handwriting), `.png`/`.svg` output
(PNG needs Pillow). `python SCRIPT render --help` lists everything.

Where to save: the folder the user named, else the current working folder; in a sandbox with an
outputs folder (e.g. `/mnt/user-data/outputs/`) save it there so the user can download it.

## 4. Report

The JSON report lists `files`, `pages`, `standard_handwriting` (characters drawn in the standard
handwriting) and `missing` (red boxes). Tell the user where the file is. If `standard_handwriting`
is not empty, mention it in one short sentence and suggest writing those characters in the app
(then export and `install` again). If the result should look different, render again with other
options or another `--seed`.

## Fair use

Only for the user's own texts. Do not imitate someone else's handwriting, never create or imitate
signatures, and do not produce documents meant to deceive (e.g. forged notes, homework or exams
that must be handwritten by the person). Politely refuse such requests.

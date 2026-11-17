# Changelog

## 1.0.0 - 2026-11-17
First public version (the project was called "Handschrift" before; its files are still read).

- **6 languages** for the whole interface (English default, Deutsch, Français, Español, Italiano,
  Polski), with the complete special letters of each language (e.g. ẞ ‚ ‘ » «, Æ Œ Ÿ, ª º ¿ ¡,
  Í Î Ó Ú, Ą Ł Ż, £).
- **Start wizard** in 6 steps: interface language, how it works, languages you write, Claude &
  documents (Claude's language, paper, size, colour, page, standard handwriting), practice, tips.
- **Standard handwriting** for characters you have not written (Hershey font + hand-drawn extras),
  fitted to your size, x-height and slant. Own samples always come first (also composed: é, ł, ½, ¿).
  Can be switched off (red boxes).
- **Claude skill `/my-handwriting`** with `info`, `install` and `package`; Claude writes Markdown and
  renders a PDF with your defaults from the app.
- **Markdown** in "Write text" and in the script: headings, lists, rules, `[[pagebreak]]`.
- **Pen laptops** (S Pen, Surface Pen): a hovering pen is detected before the first stroke and
  remembered; a pen replaces a touch (palm) stroke; side button and eraser end erase.
- **Own characters** are added directly in the overview and appear at once; characters that are
  already in a group are shown there instead.
- Faint guide letter, undo for clearing/erasing, offline app (GitHub Pages), PNG/SVG/compressed PDF.
- English project structure, MIT license, tests + GitHub Actions.

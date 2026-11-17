#!/usr/bin/env python3
"""Tests for skill/my-handwriting/scripts/my_handwriting.py and its consistency with the web app.

    python tests/py_test.py      (builds its own synthetic fixture; Pillow needed for it and for PNG)
"""
import json
import os
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skill", "my-handwriting", "scripts")
SCRIPT = os.path.join(SCRIPTS, "my_handwriting.py")
sys.path.insert(0, SCRIPTS)
import my_handwriting as hs  # noqa: E402

fails = checks = 0


def ok(cond, msg):
    global fails, checks
    checks += 1
    if not cond:
        fails += 1
        print("FAIL " + msg)


def run(*args, lang="en", env=None):
    e = dict(os.environ, MY_HANDWRITING_LANG=lang)
    e.pop("MY_HANDWRITING_GLYPHS", None)
    e.update(env or {})
    p = subprocess.run([sys.executable, SCRIPT] + list(args), capture_output=True, env=e)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def node(code, *args):
    out = subprocess.run(["node", "-e", code] + list(args), capture_output=True, check=True).stdout
    return json.loads(out.decode("utf-8"))


# 1. the same rules as the web app (charsets, replacements, Markdown blocks, standard handwriting)
try:
    js = node("const c=require(process.argv[1]);console.log(JSON.stringify(c))", os.path.join(ROOT, "js", "charsets.js"))
    ok([(g["id"], g["chars"]) for g in js["BASE"]] == [(g, c) for g, _n, c in hs.GROUPS], "BASE groups equal")
    ok(js["LANG"] == hs.LANG_GROUPS, "LANG groups equal")
    ok(js["LANG_ORDER"] == list(hs.LANG_ORDER), "LANG_ORDER equal")
    ok(js["CORE"] == list(hs.CORE_GROUPS), "CORE equal")
    r = node("const R=require(process.argv[1]);console.log(JSON.stringify({fb:R.FALLBACKS,approx:R.APPROX}))",
             os.path.join(ROOT, "js", "render.js"))
    py_fb = {k: (list(v) if isinstance(v, tuple) else v) for k, v in hs.FALLBACKS.items()}
    ok(r["fb"] == py_fb, "FALLBACKS equal: %s" % sorted(set(r["fb"].items()) ^ set((k, json.dumps(v)) for k, v in py_fb.items()))[:3]
       if r["fb"] != py_fb else "FALLBACKS equal")
    ok(r["approx"] == hs.APPROX, "APPROX equal")
    lines = ["# Title", "## Sub ##", "### small", "- item", "  * nested", "    + deeper", "12. twelve", "b) letter", "> quote",
             "---", "***", "[[pagebreak]]", "plain **bold** __u__ `code`", "#no heading", "-no list"]
    jsb = node("const R=require(process.argv[1]);console.log(JSON.stringify(JSON.parse(process.argv[2]).map(l=>R.parseBlock(l,true))))",
               os.path.join(ROOT, "js", "render.js"), json.dumps(lines))
    for line, jb in zip(lines, jsb):
        pb = hs.parse_block(line, True)
        ok(all(abs(pb.get(k, 0) - jb.get(k, 0)) < 1e-9 if isinstance(jb.get(k), (int, float)) and not isinstance(jb.get(k), bool)
               else pb.get(k) == jb.get(k) for k in set(jb) | set(pb)), "parse_block %r: %s vs %s" % (line, pb, jb))
    font_js = node("console.log(JSON.stringify(require(process.argv[1])))", os.path.join(ROOT, "js", "fallback-font.js"))
    font_py = json.load(open(os.path.join(SCRIPTS, "fallback_font.json"), encoding="utf-8"))
    ok(font_js == font_py, "standard handwriting identical in js/ and skill/ (run tools/build_fallback_font.py)")
except (OSError, subprocess.CalledProcessError) as e:
    print("note: node not available, comparison with the web app skipped (%s)" % e)

tmp = tempfile.mkdtemp(prefix="mh-test-")
fx = os.path.join(tmp, "fx.json")
subprocess.run([sys.executable, os.path.join(ROOT, "tests", "make_fixture.py"), fx, "--samples", "3"], check=True, capture_output=True)
basic = os.path.join(tmp, "basic.json")
subprocess.run([sys.executable, os.path.join(ROOT, "tests", "make_fixture.py"), basic, "--samples", "3",
                "--chars", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-'\""], check=True, capture_output=True)

# 2. check
code, out, err = run("check", "--glyphs", fx, "--json")
rep = json.loads(out)
ok(code == 0 and rep["verdict_code"] == "ready", "check ready: %s" % rep.get("verdict_code"))
ok(rep["scripts"] == list(hs.LANG_ORDER), "scripts from file")
code, out, err = run("check", "--glyphs", basic, "--json", "--scripts", "de")
rep = json.loads(out)
ok(rep["verdict_code"] in ("usable", "incomplete") and set(rep["core_missing"]) >= set("ÄÖÜäöüß"), "basic: not ready, umlauts missing")
code, out, err = run("check", "--glyphs", fx, lang="de")
ok("Großbuchstaben" in out and "Ergebnis: bereit" in out, "German output")
code, out, err = run("--lang", "en", "check", "--glyphs", fx, lang="de")
ok("Capital letters" in out and "Result: ready" in out, "--lang en overrides")

# 3. render all formats; every language's letters
txt = os.path.join(tmp, "t.txt")
with open(txt, "w", encoding="utf-8") as fh:
    fh.write("¿Qué tal? Łódź – „Grüße“ ½ [[3/4]] Œuvre ẞ ª º £\n" + "Line\n" * 70)
for ext in ("pdf", "svg", "png"):
    o = os.path.join(tmp, "out." + ext)
    code, out, err = run("render", "--glyphs", fx, "--input", txt, "--out", o, "--json", "--seed", "4")
    ok(code == 0, "render %s exit %s %s" % (ext, code, err))
    if code == 0:
        rep = json.loads(out)
        ok(rep["pages"] >= (2 if ext == "pdf" else 1) and not rep["missing"] and not rep["standard_handwriting"],
           "render %s pages/missing: %s" % (ext, rep))
        ok(all(os.path.getsize(f) > 500 for f in rep["files"]), "render %s files" % ext)
all_letters = "".join(hs.LANG_GROUPS[c] for c in hs.LANG_ORDER)
code, out, err = run("render", "--glyphs", basic, "--text", all_letters, "--out", os.path.join(tmp, "l.svg"), "--json")
rep = json.loads(out)
ok(code == 0 and not rep["missing"], "all special letters work with only basic samples: missing %s" % rep.get("missing"))
ok({"é", "ñ", "ą"} <= set(rep["fallbacks"]) and "ß" in rep["standard_handwriting"], "composed + standard handwriting: %s" % rep["standard_handwriting"])
code, out, err = run("render", "--glyphs", basic, "--text", all_letters, "--out", os.path.join(tmp, "l2.svg"), "--json", "--no-font")
rep = json.loads(out)
ok(code == 0 and rep["missing"] and not rep["standard_handwriting"], "--no-font: red boxes instead")
code, out, err = run("render", "--glyphs", basic, "--text", "€ ł", "--out", os.path.join(tmp, "e.svg"), "--json")
rep = json.loads(out)
ok(rep["standard_handwriting"] == ["€"] and rep["fallbacks"].get("ł") == "l + /", "€ from the font, ł from own l: %s" % rep)
code, out, err = run("render", "--glyphs", basic, "--text", "Ω", "--out", os.path.join(tmp, "x.svg"), "--missing", "error")
ok(code == 2 and "Ω" in err, "missing=error stops with exit 2")
code, out, err = run("render", "--glyphs", os.path.join(tmp, "nope.json"), "--text", "x", "--out", os.path.join(tmp, "x.svg"))
ok(code == 2 and "Sample file not found" in err and "install --glyphs" in err, "clear error for a missing file")
code, out, err = run("render", "--glyphs", fx, "--text", "Hi", "--out", os.path.join(tmp, "x.svg"))
ok(code == 0 and "✓" in out, "✓ survives a pipe (Windows code page)")

# 4. Markdown + page break; defaults from the app (settings.claude)
md = os.path.join(tmp, "letter.md")
with open(md, "w", encoding="utf-8") as fh:
    fh.write("# Dear Ann\n\nThank you!\n\n- one\n- two\n1. first\n---\n[[pagebreak]]\nPage two")
code, out, err = run("render", "--glyphs", fx, "--input", md, "--markdown", "--out", os.path.join(tmp, "md.pdf"), "--json")
rep = json.loads(out)
ok(code == 0 and rep["pages"] == 2 and rep["settings"]["markdown"], "markdown + page break: %s" % rep.get("pages"))
ok(rep["settings"]["paper"] == "lined" and rep["settings"]["size"] == 6.0, "built-in Claude defaults: %s" % rep["settings"])
withc = json.load(open(fx, encoding="utf-8"))
withc["settings"]["claude"] = {"lang": "de", "paper": "grid", "size": 8, "color": "black", "page": "a5", "fallback": "box"}
cpath = os.path.join(tmp, "claude.json")
json.dump(withc, open(cpath, "w", encoding="utf-8"))
code, out, err = run("render", "--glyphs", cpath, "--text", "Hi", "--out", os.path.join(tmp, "c.pdf"), "--json")
rep = json.loads(out)
ok(rep["settings"] == {"paper": "grid", "size": 8.0, "color": "black", "page": "a5", "markdown": False, "font": False},
   "defaults from the app: %s" % rep["settings"])
code, out, err = run("render", "--glyphs", cpath, "--text", "Hi", "--out", os.path.join(tmp, "c2.pdf"), "--json", "--paper", "blank", "--font")
rep = json.loads(out)
ok(rep["settings"]["paper"] == "blank" and rep["settings"]["font"], "command line beats the app defaults")

# 5. info (what the skill reads first)
code, out, err = run("info", "--glyphs", cpath)
info = json.loads(out)
ok(code == 0 and info["ready"] and info["claude"]["lang"] == "de" and info["languages"] == list(hs.LANG_ORDER), "info: %s" % info.get("claude"))
ok(info["standard_handwriting_available"] and "missing" in info["languages_missing"]["pl"], "info: per language")
code, out, err = run("info", env={"HOME": tmp, "USERPROFILE": tmp, "MY_HANDWRITING_GLYPHS": os.path.join(tmp, "none.json")})
info = json.loads(out)
ok(code == 1 and not info["ready"] and "install --glyphs" in info["problem"], "info without a file explains what to do")
code, out, err = run("info", env={"MY_HANDWRITING_GLYPHS": fx})
ok(code == 0 and json.loads(out)["glyphs"] == os.path.abspath(fx), "MY_HANDWRITING_GLYPHS is used")

# 6. install + package
dest = os.path.join(tmp, "skills", "my-handwriting")
code, out, err = run("install", "--glyphs", fx, "--dest", dest)
ok(code == 0 and os.path.isfile(os.path.join(dest, "SKILL.md")) and os.path.isfile(os.path.join(dest, "data", "glyphs.json"))
   and os.path.isfile(os.path.join(dest, "scripts", "fallback_font.json")), "install copies the skill + file: %s %s" % (out, err))
code, out, err = run("install", "--glyphs", cpath, "--dest", dest)
ok(code == 0 and os.path.isfile(os.path.join(dest, "data", "glyphs.json.bak")), "install again keeps a backup")
inst = os.path.join(dest, "scripts", "my_handwriting.py")
p = subprocess.run([sys.executable, inst, "info"], capture_output=True, env=dict(os.environ, MY_HANDWRITING_LANG="en"))
ok(p.returncode == 0 and json.loads(p.stdout.decode("utf-8"))["glyphs"] == os.path.join(dest, "data", "glyphs.json"),
   "installed skill finds its own file")
code, out, err = run("install", "--glyphs", os.path.join(tmp, "broken.json"), "--dest", os.path.join(tmp, "x"))
ok(code == 2 and not os.path.exists(os.path.join(tmp, "x")), "install with a wrong file changes nothing")
zp = os.path.join(tmp, "skill.zip")
code, out, err = run("package", "--glyphs", fx, "--out", zp)
names = zipfile.ZipFile(zp).namelist() if code == 0 else []
ok({"my-handwriting/SKILL.md", "my-handwriting/scripts/my_handwriting.py", "my-handwriting/scripts/fallback_font.json",
    "my-handwriting/data/glyphs.json"} <= set(names), "package zip: %s" % names)

# 7. files of the old name / old version are read
v1 = json.load(open(fx, encoding="utf-8"))
v1["format"] = "handschrift-glyphs"
v1["settings"] = {"target": 3}
v1path = os.path.join(tmp, "v1.json")
json.dump(v1, open(v1path, "w", encoding="utf-8"))
code, out, err = run("check", "--glyphs", v1path, "--json")
ok(code == 0 and json.loads(out)["scripts"] == ["de"], "old file (handschrift-glyphs, v1.0) = German")
bad = dict(v1, format="something-else")
json.dump(bad, open(os.path.join(tmp, "bad.json"), "w", encoding="utf-8"))
code, out, err = run("check", "--glyphs", os.path.join(tmp, "bad.json"))
ok(code == 2 and "Unknown file format" in err, "unknown format is refused")

# 8. PDF structure
pdf = open(os.path.join(tmp, "out.pdf"), "rb").read()
sx = int(pdf.rsplit(b"startxref\n", 1)[1].split(b"\n")[0])
ok(pdf[sx:sx + 4] == b"xref", "pdf startxref")

print(("FAILED %d" % fails if fails else "OK") + " - %d checks (files in %s)" % (checks, tmp))
sys.exit(1 if fails else 0)

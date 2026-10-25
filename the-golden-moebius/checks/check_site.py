#!/usr/bin/env python3
"""Check the shipped site, including relative assets, fragments and inline JS."""
from __future__ import annotations
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1] / "dist"


class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=set(); self.refs=[]; self.inline=[]; self.styles=[]; self.active=None; self.data=[]; self.h1=0
    def handle_starttag(self, tag, attributes):
        attrs=dict(attributes)
        if "id" in attrs:
            if attrs["id"] in self.ids: raise ValueError("Duplicate id: " + attrs["id"])
            self.ids.add(attrs["id"])
        if tag == "h1": self.h1 += 1
        for attribute in ("src", "href"):
            if attribute in attrs: self.refs.append((attrs[attribute], tag, attribute))
        if "srcset" in attrs:
            for candidate in attrs["srcset"].split(","): self.refs.append((candidate.strip().split()[0], tag, "srcset"))
        if tag == "script" and attrs.get("src", "").startswith(("http://", "https://")):
            raise ValueError("Runtime script is not bundled locally.")
        if tag == "script" and "src" not in attrs:
            self.active=attrs.get("type", "classic"); self.data=[]
        if tag == "style": self.active="style"; self.data=[]
    def handle_data(self, data):
        if self.active: self.data.append(data)
    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.active:
            if self.active == "style": self.styles.append("".join(self.data))
            else: self.inline.append((self.active,"".join(self.data)))
            self.active=None;self.data=[]


def local_target(page, reference):
    url=urlsplit(reference)
    if url.scheme or url.netloc or reference.startswith(("data:", "mailto:", "tel:")): return None
    target=(ROOT / unquote(url.path).lstrip("/")) if url.path.startswith("/") else page.parent / unquote(url.path)
    if not url.path: target=page
    target=target.resolve()
    if not target.is_relative_to(ROOT.resolve()): raise ValueError("Reference leaves the public site: " + reference)
    if target.is_dir(): target=target / "index.html"
    return target,unquote(url.fragment)


def main():
    pages={}
    for path in ROOT.rglob("*.html"):
        parsed=Page();parsed.feed(path.read_text());pages[path.resolve()]=parsed
        assert parsed.h1 == 1, f"Expected one h1: {path}"
    count=0; scripts=0
    for page, parsed in pages.items():
        for reference, tag, attr in parsed.refs:
            target=local_target(page,reference)
            if target is None: continue
            path,fragment=target
            assert path.is_file(), f"Missing {tag} {attr}: {page.relative_to(ROOT)} -> {reference}"
            if fragment and path in pages:
                assert fragment in pages[path].ids, f"Missing fragment: {reference} in {page}"
            count += 1
        for style in parsed.styles:
            for reference in re.findall(r"url\([\"']?([^\)\"']+)",style):
                target=local_target(page,reference)
                if target: assert target[0].is_file(), (page,reference)
        for kind,script in parsed.inline:
            if kind in ("importmap","application/ld+json"):
                data=json.loads(script)
                if kind == "importmap":
                    for reference in data.get("imports",{}).values():
                        assert not reference.startswith(("http:","https:")), "Import is not local"
                        assert local_target(page,reference)[0].is_file()
            else:
                with tempfile.TemporaryDirectory() as tmp:
                    file=Path(tmp)/("script.mjs" if kind=="module" else "script.cjs");file.write_text(script)
                    subprocess.run(["node","--check",str(file)],check=True,capture_output=True)
                    scripts += 1
    for path in ROOT.rglob("*.css"):
        for reference in re.findall(r"url\([\"']?([^\)\"']+)",path.read_text()):
            target=local_target(path,reference)
            if target: assert target[0].is_file(), (path,reference)
    version=json.loads((ROOT/"site-version.json").read_text())
    assert re.fullmatch(r"[0-9a-f]{16}",version["build"])
    for folder in ("viewer","gold-rush","west-bank"):
        assert (ROOT/folder/"index.html").is_file() and (ROOT/folder/"play.html").is_file()
    print(f"PASS: {len(pages)} HTML pages, {count} local links/assets/fragments, {scripts} inline scripts, styles and local imports.")


if __name__ == "__main__": main()

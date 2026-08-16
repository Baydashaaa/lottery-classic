#!/usr/bin/env python3
"""Put chain-tickets.js into the bundle.

Two things came together here.

The page loads assets/js/oracle-draw.bundle.js, and that file was last built on
3 August. Everything changed in draw-v2 since then - the wait windows, the idle
spin speed, the local result - sits in the sources and never reaches a browser.
That is why the wheel still gave up after 12 minutes yesterday: the fix was
real, the bundle was not rebuilt. Checking the served draw-v2/Config.js proved
nothing, because nothing loads it.

And the bundler strips every `import` line and concatenates a fixed list of
files. chain-tickets.js is not on that list, so buildLocalSnapshot would simply
be undefined at runtime.

It goes first: everything else may reference it, and nothing it needs comes
from the others.

Run from ~/oracle-draw.
"""
import sys

P = "dev/_build_bundle.js"
s = open(P).read()

if "chain-tickets.js" in s:
    sys.exit("already patched")

old = """const files = [
  ...WHEEL.map(f => ["assets/js/wheel/" + f, f]),"""
new = """const files = [
  // Правило построения билетов. Лежит в корне, потому что им пользуется и
  // lottery-draw.js - один экземпляр на скрипт и на браузер. Идёт первым:
  // на него ссылается DrawEngine, а ему самому ничего отсюда не нужно.
  ["chain-tickets.js", "chain-tickets.js"],
  ...WHEEL.map(f => ["assets/js/wheel/" + f, f]),"""

if s.count(old) != 1:
    sys.exit(f"file list anchor: {s.count(old)} matches")

open(P, "w").write(s.replace(old, new, 1))
print("ok: chain-tickets.js added to the bundle")
print("\nRebuild next: node dev/_build_bundle.js")
print("It will refuse to build on a name clash - that check is the point.")

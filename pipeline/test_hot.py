"""Checks that the site's "as of" date is the data's date, not the download's.

    python pipeline/test_hot.py

stage4_hot.py carries the HOT export's Last-Modified across as the cached file's
mtime and publishes the newest of them in summary.json. Nothing else in the
pipeline reads that date, so if the round trip is wrong the site states a
confident wrong vintage and every other check still passes -- which is worse
than stating no date at all.
"""

import tempfile
from pathlib import Path

import config as cfg
import stage4_hot as s4


def test_vintage_is_the_newest_source_date():
    # Two layers, two dates: the survey is as new as its newest layer.
    with tempfile.TemporaryDirectory() as d:
        cfg.HOT = Path(d)
        for name, header in (("first_fill", "Sun, 31 Aug 2026 13:43:14 GMT"),
                             ("remapped", "Fri, 02 Oct 2026 10:03:45 GMT")):
            p = cfg.HOT / f"{name}.geojson"
            p.write_text("{}")
            s4._stamp(p, header)
        assert s4.hot_vintage() == "2026-10-02", s4.hot_vintage()


def test_missing_header_leaves_the_file_alone():
    # S3 sends Last-Modified on every object, but a mirror or proxy need not,
    # and a crash there would cost the layer rather than just its date.
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "x.geojson"
        p.write_text("{}")
        before = p.stat().st_mtime
        s4._stamp(p, None)
        assert p.stat().st_mtime == before


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  ok  {name}")
    print("\nOK - the published vintage is the export's own date")

"""Checks for stage 6's confirmation test, on a scene solved on paper.

    python pipeline/test_late.py

The two things that would silently corrupt the result rather than crash it: a
cloudy pixel counted as "no longer changed", which charges the cloud to the
detector, and a debias that drags the whole scene across the threshold instead
of centring it. Both produce a plausible percentage either way.
"""

import numpy as np

import config as cfg
import stage6_late as s6

GOOD = (slice(10, 20), slice(10, 20))    # the 100 px that really changed
BLIND = (slice(60, 70), slice(60, 70))   # the 100 px the late scene cannot see


def scene(b8, b4, b3=0.10, b11=0.20, b12=0.20):
    """A flat 100x100 Sentinel-2 stack. NDVI = (B8-B4)/(B8+B4)."""
    full = lambda v: np.full((100, 100), v, dtype="float32")
    return {"B8": full(b8), "B4": full(b4), "B3": full(b3),
            "B11": full(b11), "B12": full(b12)}


def pair():
    pre = scene(0.40, 0.10)                 # NDVI 0.600
    late = scene(0.40, 0.10)
    late["B8"][GOOD] = 0.15                 # NDVI 0.111, so dNDVI 0.489
    late["B4"][GOOD] = 0.12
    late["B8"][BLIND] = np.nan              # cloud in the late scene
    return pre, late


def test_vegetation_loss_clears_the_threshold_and_nothing_else_does():
    changed, valid, off = s6.late_change(*pair())
    assert abs(off["dNDVI"]) < 1e-6, f"debias moved an unchanged scene: {off}"
    assert changed[GOOD].all(), "a 0.489 dNDVI drop did not clear 0.25"
    assert not changed[30:40, 30:40].any(), "unchanged ground flagged"
    assert cfg.T_DNDVI < 0.489, "the fixture no longer exceeds the threshold"


def test_an_unseen_pixel_is_an_abstention_not_a_denial():
    changed, valid, _ = s6.late_change(*pair())
    assert not valid[BLIND].any(), "a NaN late pixel was called a valid pair"
    assert not changed[BLIND].any(), "a NaN late pixel was called changed"

    # The whole point of rate(): the blind block must leave the denominator too.
    # Scored as unconfirmed it would read 50%, which is the wrong answer twice.
    sel = np.zeros((100, 100), dtype=bool)
    sel[GOOD] = True
    sel[BLIND] = True
    n, pct = s6.rate(changed, valid, sel)
    assert (n, pct) == (100, 100.0), f"blind pixels leaked into the score: {n} {pct}"


def test_nothing_comparable_scores_nothing_rather_than_zero():
    changed, valid, _ = s6.late_change(*pair())
    n, pct = s6.rate(changed, valid, np.zeros((100, 100), dtype=bool))
    assert (n, pct) == (0, None), f"an empty group scored {pct} instead of None"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  ok  {name}")
    print("\nOK - the late check confirms change and abstains on cloud")

"""Checks for stage 5's tone curve, the one thing on the slider that is a choice.

    python pipeline/test_overlays.py

The curve replaced a stretch that clipped the flood deposit to white, so the
check that matters is that the deposit's reflectance still has somewhere to go.
"""

import numpy as np

import stage5_overlays as s5


def test_deposit_is_not_clipped():
    # Green valley, bare riverbed, fresh deposit, cloud: all distinct, none white.
    grey = np.array([0.05, 0.13, 0.3, 0.4])
    out = s5.tone(np.stack([grey] * 3))[0]
    assert np.all(np.diff(out) > 0.05), f"levels merge: {out}"
    assert out[-1] < 0.95, f"0.4 reflectance renders white: {out[-1]}"
    assert s5.tone(np.zeros((3, 1)))[0, 0] == 0


def test_hue_survives():
    # One curve for all three bands, so an equal-reflectance pixel stays grey.
    out = s5.tone(np.full((3, 1), 0.2))
    assert np.ptp(out) < 1e-9, f"grey came out tinted: {out.ravel()}"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  ok  {name}")
    print("\nOK - the tone curve keeps the deposit and the hue")

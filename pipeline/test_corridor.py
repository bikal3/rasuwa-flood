"""Checks for stage 3's flow routing, on a valley whose answer is known on paper.

    python pipeline/test_corridor.py

A synthetic V-valley: the floor runs down column 40, the sides rise 5 m per cell
and the floor drops 2 m per row. D8 sends a hillslope cell straight across the
contour rather than diagonally downstream, because 5 m over one cell beats
(5+2) m over sqrt(2) cells, so the flow path from (row, col) reaches the channel
at (row, 40) and

    HAND(row, col) = 5 * |col - 40|   metres

exactly. Every assertion below falls out of that one line.
"""

import numpy as np

import config as cfg
import stage3_corridor as s3

N = 200
PIXEL = 20.0
CHANNEL_COL = 40
SIDE, DOWN = 5.0, 2.0             # m per cell across / along the valley

# HAND <= 30 m at 5 m per cell -> 6 cells either side of the floor.
REACH = int(cfg.HAND_MAX_M // SIDE)
FLOOR = np.s_[CHANNEL_COL - REACH:CHANNEL_COL + REACH + 1]

# A 200x200 toy at 20 m is 16 km2 in total, so the real 8 km2 threshold would
# put the channel head at row 99 and leave most of the grid with no drainage to
# be above. Scale the knob to the toy; everything else stays at its real value.
cfg.MIN_DRAINAGE_KM2 = 0.2


def valley():
    yy, xx = np.mgrid[0:N, 0:N]
    return 3000.0 - DOWN * yy + SIDE * np.abs(xx - CHANNEL_COL)


def test_fill_pits_fills_a_bowl():
    """A pit must come back at its spill level, and nothing else may move."""
    e = np.full((40, 40), 100.0)
    e[10:14, 10:14] = 60.0                 # a bowl, 40 m deep, rim at 100
    e[20, 20] = 130.0                      # a peak, must be left alone
    valid = np.ones_like(e, bool)
    filled = s3.fill_pits(s3.pad(e, np.nan), s3.pad(valid, False))
    filled = s3.unpad(filled)

    assert (filled[10:14, 10:14] >= 100.0).all(), "bowl was not filled to the rim"
    assert filled[10:14, 10:14].max() < 100.1, "bowl was over-filled"
    assert filled[20, 20] == 130.0, "fill must never lower ground"
    # Flat ground picks up only the eps tilt the fill uses to break flats.
    assert np.abs(filled[30:, 30:] - 100.0).max() < 0.1, "flat ground moved"


def test_hand_matches_the_valley_geometry():
    t = s3.corridor_from_dem(valley(), PIXEL)
    hand, drainage, corridor = t["hand_m"], t["drainage_km2"], t["corridor"]

    # Mid-grid row, clear of the domain rim.
    row = 150
    for k in range(0, 12):
        for col in (CHANNEL_COL - k, CHANNEL_COL + k):
            assert abs(hand[row, col] - SIDE * k) < 0.5, \
                f"HAND at ({row},{col}) was {hand[row, col]:.2f}, expected {SIDE * k}"

    assert corridor[row, FLOOR].all(), "the whole valley floor must be corridor"
    assert not corridor[row, :CHANNEL_COL - REACH].any(), "corridor leaked up the west side"
    assert not corridor[row, CHANNEL_COL + REACH + 1:].any(), "corridor leaked up the east side"

    # Everything drains to the one outlet at the bottom of the channel.
    total_km2 = N * N * PIXEL * PIXEL / 1e6
    assert drainage.max() > 0.98 * total_km2, \
        f"outlet collects {drainage.max():.2f} of {total_km2:.2f} km² -- routing is leaking"
    assert t["channel"][row, CHANNEL_COL], "the valley floor is not a channel"
    assert not t["channel"][row, CHANNEL_COL + 3], "the channel is wider than one cell"


def test_corridor_rejects_hillslope_change():
    """The point of the stage: same detection, different landform."""
    t = s3.corridor_from_dem(valley(), PIXEL)
    change = np.zeros((N, N), bool)
    change[100:120, CHANNEL_COL - 3:CHANNEL_COL + 4] = True    # on the valley floor
    change[100:120, 150:170] = True                            # high on the side

    flood = change & t["corridor"]
    assert flood[100:120, CHANNEL_COL - 3:CHANNEL_COL + 4].all(), "floor change was dropped"
    assert not flood[100:120, 150:170].any(), "hillslope change survived the corridor"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  ok  {name}")
    print("\nOK - fill, D8, accumulation and corridor all check out")

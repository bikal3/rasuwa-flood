"""Stage 5 -- pre/post overlays for the site's before/after slider.

    python pipeline/stage5_overlays.py

Reprojects the Sentinel-2 and Sentinel-1 composites to Web Mercator and writes
them as PNGs the Leaflet map can lay over the terrain, plus the metadata the
slider labels itself with.

Reads   data/raster/s2_pre.tif, s2_post.tif      (stage 1)
        data/raster/s1_pre.tif, s1_post.tif      (stage 1)
Writes  web/public/data/{s2,s1}_{pre,post}.png
        web/public/data/overlays.json            bounds, windows, valid cover

Two pairs, because one of them cannot answer the question on its own:

- **Optical (s2).** True colour, the picture anyone can read without being told
  how. The post-event composite is 17% cloud-free -- six days of monsoon over a
  Himalayan gorge -- so most of the "after" frame is a hole. Widening the window
  does not help: the event is six days old, there is no later imagery yet.
- **Radar (s1).** Sentinel-1 does not care about cloud, so both dates are
  complete. VV backscatter in dB, rendered grey: smooth water reflects away from
  the sensor and comes back near black, so the widened channel is the thing that
  moves when you swipe. This is the cloud-free before/after.

Two things this does that stage 2's plate does not:

- **One stretch for both dates.** stage2.rgb() percentile-stretches each image
  independently, which is right for looking at one scene and wrong for comparing
  two: half the apparent "change" between them would be the normalisation moving,
  not the ground. The stretch here is computed on the pre-event image and applied
  unchanged to the post, so a pixel that looks brighter after really is brighter.
- **EPSG:3857, not UTM.** Leaflet's ImageOverlay stretches an image linearly
  between two corners in Web Mercator. Handing it a UTM raster and lat/lon corners
  puts the pixels in roughly the right place and precisely the wrong one -- the
  error grows across the frame. Reprojecting first makes the linear stretch exact.

Where a composite has no valid pixel the PNG is transparent rather than filled.
The slider clips both images to the divider, so a gap in the "after" shows as a
gap instead of quietly revealing the "before" underneath it.
"""

import json
import sys

import numpy as np
import rasterio
from PIL import Image
from rasterio.warp import Resampling, calculate_default_transform, reproject
from rasterio.warp import transform_bounds

import config as cfg

WEB_CRS = "EPSG:3857"


def read_bands(path, bands):
    """-> (n, h, w) float32 with NaN nodata, plus the source profile."""
    with rasterio.open(path) as src:
        idx = [list(src.descriptions).index(b) + 1 for b in bands]
        arr = src.read(idx, masked=True).astype("float32").filled(np.nan)
        return arr, src.profile


def s2_rgb(path):
    """Sentinel-2 true colour."""
    return read_bands(path, ("B4", "B3", "B2"))


def s1_grey(path):
    """Sentinel-1 VV backscatter in dB, repeated into three grey channels.

    VV alone rather than a VV/VH/VV-VH false colour: in a gorge this steep the
    colour version is dominated by layover and shadow striping, which is fixed
    terrain geometry, identical in both dates, and reads as noise the eye has to
    subtract before it can see anything. Grey puts every surface on one scale and
    leaves the dark, widened channel as the only thing that changes across the
    divider.
    """
    arr, profile = read_bands(path, ("VV",))
    return np.repeat(arr, 3, axis=0), profile


# (id, label, reader, (pre window, post window), provenance, what the gaps are)
# The last field is the word the slider puts after the valid percentage. For the
# optical pair the gaps are cloud; for radar they are the corner collar left by
# reprojecting a UTM rectangle to Web Mercator, and calling that "cloud-free"
# would credit Sentinel-1 with beating a problem it never had.
SENSORS = (
    ("s2", "Optical", s2_rgb, (cfg.S2_PRE, cfg.S2_POST),
     "Sentinel-2 L2A true colour, cloud-masked median composite", "cloud-free"),
    ("s1", "Radar", s1_grey, (cfg.S1_PRE, cfg.S1_POST),
     "Sentinel-1 GRD median, VV backscatter in dB \u2014 sees through cloud",
     "in frame"),
)


def to_web_mercator(arr, profile):
    """Reproject a float stack to EPSG:3857. -> (stack, transform, (w, h))"""
    transform, w, h = calculate_default_transform(
        profile["crs"], WEB_CRS, profile["width"], profile["height"],
        *rasterio.transform.array_bounds(
            profile["height"], profile["width"], profile["transform"])[:4],
    )
    out = np.full((arr.shape[0], h, w), np.nan, dtype="float32")
    for i in range(arr.shape[0]):
        reproject(
            source=arr[i], destination=out[i],
            src_transform=profile["transform"], src_crs=profile["crs"],
            src_nodata=np.nan,
            dst_transform=transform, dst_crs=WEB_CRS, dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
    return out, transform, (w, h)


def stretch_bounds(stack, lo=2, hi=98):
    """Per-band percentile limits, from one image, reused for both dates."""
    return [
        tuple(np.percentile(b[np.isfinite(b)], [lo, hi])) if np.isfinite(b).any()
        else (0.0, 1.0)
        for b in stack
    ]


def to_rgba(stack, limits):
    """Apply fixed limits and turn nodata into transparency. -> (h, w, 4) uint8"""
    bands = []
    for b, (p1, p2) in zip(stack, limits):
        bands.append(np.clip((b - p1) / (p2 - p1 + 1e-9), 0, 1))
    rgb = np.dstack(bands)
    alpha = np.isfinite(rgb).all(axis=2)
    rgba = np.dstack([np.nan_to_num(rgb), alpha.astype("float32")])
    return (rgba * 255).astype("uint8"), float(alpha.mean())


def save_png(path, rgba):
    """Write RGBA as an 8-bit palette PNG: 255 colours plus a transparent index.

    These files ship in the repo and are fetched whole when the slider opens, so
    their size is the load time. A 32-bit RGBA PNG of stretched satellite imagery
    is 5-7 MB; quantising the colours costs ~3 levels out of 255 in mean error --
    invisible on a photograph, and well under the noise in the composite itself
    -- for about a third of the bytes. Alpha stays exact because it is binary
    here: a pixel is either masked or it is not, so it needs one reserved index
    rather than a channel.
    """
    opaque = rgba[..., 3] == 255
    pal = Image.fromarray(rgba[..., :3]).quantize(
        colors=255, method=Image.Quantize.FASTOCTREE)
    idx = np.asarray(pal, dtype="uint8").copy()
    idx[~opaque] = 255
    out = Image.fromarray(idx, mode="P")
    out.putpalette((pal.getpalette() + [0] * 768)[:768])
    out.save(path, optimize=True, transparency=255)


def main():
    needed = [f"{sid}_{half}" for sid, *_ in SENSORS for half in ("pre", "post")]
    missing = [n for n in needed if not (cfg.RASTER / f"{n}.tif").exists()]
    if missing:
        sys.exit(f"Missing {missing} in {cfg.RASTER}. Run stage1_export.py first.")
    cfg.SITE_DATA.mkdir(parents=True, exist_ok=True)

    meta, bounds = {}, None
    for sid, label, reader, windows, _, cover_word in SENSORS:
        print(f"{label} overlays")
        pre_arr, profile = reader(cfg.RASTER / f"{sid}_pre.tif")
        post_arr, _ = reader(cfg.RASTER / f"{sid}_post.tif")

        pre_web, transform, (w, h) = to_web_mercator(pre_arr, profile)
        post_web, _, _ = to_web_mercator(post_arr, profile)
        print(f"  reprojected to {WEB_CRS}: {w} x {h}")

        # The pre-event image sets the scale; the post is measured against it.
        limits = stretch_bounds(pre_web)
        print("  shared stretch: "
              + ", ".join(f"{lo:.2f}..{hi:.2f}" for lo, hi in limits))

        west, south, east, north = transform_bounds(
            WEB_CRS, "EPSG:4326",
            *rasterio.transform.array_bounds(h, w, transform)[:4])
        # Leaflet wants [[south, west], [north, east]]. Both sensors come off the
        # same stage 1 grid, so one set of corners has to fit both -- if it ever
        # stops fitting, the slider would be comparing two different footprints.
        corners = [[south, west], [north, east]]
        if bounds is not None and corners != bounds:
            sys.exit(f"{sid} is not on the same grid as the others: "
                     f"{corners} vs {bounds}")
        bounds = corners

        for half, stack, window in (("pre", pre_web, windows[0]),
                                    ("post", post_web, windows[1])):
            rgba, cover = to_rgba(stack, limits)
            path = cfg.SITE_DATA / f"{sid}_{half}.png"
            save_png(path, rgba)
            meta[f"{sid}_{half}"] = {"window": list(window),
                                     "valid_pct": round(100 * cover, 1)}
            print(f"  {path.name}  {path.stat().st_size / 1e6:.1f} MB, "
                  f"{100 * cover:.0f}% {cover_word}")

    (cfg.SITE_DATA / "overlays.json").write_text(json.dumps({
        "bounds": bounds,
        "event": cfg.EVENT,
        "sensors": [{"id": sid, "label": label, "source": source, "cover": word}
                    for sid, label, _, _, source, word in SENSORS],
        "note": "Both dates share one contrast stretch, computed on the pre-event "
                "image, so a difference in brightness is a difference on the ground.",
        **meta,
    }, indent=1))
    print(f"\nDone. Overlays in {cfg.SITE_DATA}")


if __name__ == "__main__":
    main()

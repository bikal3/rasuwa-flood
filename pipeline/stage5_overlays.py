"""Stage 5 -- pre/post true-colour overlays for the site's before/after slider.

    python pipeline/stage5_overlays.py

Reprojects the Sentinel-2 composites to Web Mercator and writes them as PNGs the
Leaflet map can lay over the terrain, plus the metadata the slider labels itself
with.

Reads   data/raster/s2_pre.tif, s2_post.tif      (stage 1)
Writes  web/public/data/s2_pre.png, s2_post.png
        web/public/data/overlays.json            bounds, windows, valid cover

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

The post-event composite is mostly cloud. That is the real state of the data, so
the gaps are written as transparent rather than filled, and the valid fraction
goes into overlays.json for the slider to state on its face.
"""

import json
import sys

import matplotlib.image
import numpy as np
import rasterio
from rasterio.warp import Resampling, calculate_default_transform, reproject
from rasterio.warp import transform_bounds

import config as cfg

WEB_CRS = "EPSG:3857"
RGB = ("B4", "B3", "B2")


def read_rgb(path):
    """-> (3, h, w) float32 with NaN nodata, plus the source profile."""
    with rasterio.open(path) as src:
        idx = [list(src.descriptions).index(b) + 1 for b in RGB]
        arr = src.read(idx, masked=True).astype("float32").filled(np.nan)
        return arr, src.profile


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


def main():
    missing = [n for n in ("s2_pre", "s2_post")
               if not (cfg.RASTER / f"{n}.tif").exists()]
    if missing:
        sys.exit(f"Missing {missing} in {cfg.RASTER}. Run stage1_export.py first.")
    cfg.SITE_DATA.mkdir(parents=True, exist_ok=True)

    print("Sentinel-2 overlays")
    pre_arr, profile = read_rgb(cfg.RASTER / "s2_pre.tif")
    post_arr, _ = read_rgb(cfg.RASTER / "s2_post.tif")

    pre_web, transform, (w, h) = to_web_mercator(pre_arr, profile)
    post_web, _, _ = to_web_mercator(post_arr, profile)
    print(f"  reprojected to {WEB_CRS}: {w} x {h}")

    # The pre-event image sets the scale; the post is measured against it.
    limits = stretch_bounds(pre_web)
    print("  shared stretch (reflectance): "
          + ", ".join(f"{b} {lo:.3f}-{hi:.3f}" for b, (lo, hi) in zip(RGB, limits)))

    west, south, east, north = transform_bounds(
        WEB_CRS, "EPSG:4326",
        *rasterio.transform.array_bounds(h, w, transform)[:4])

    meta = {}
    for name, stack, window in (("s2_pre", pre_web, cfg.S2_PRE),
                                ("s2_post", post_web, cfg.S2_POST)):
        rgba, cover = to_rgba(stack, limits)
        path = cfg.SITE_DATA / f"{name}.png"
        matplotlib.image.imsave(path, rgba)
        meta[name] = {"window": list(window), "valid_pct": round(100 * cover, 1)}
        print(f"  {path.name}  {path.stat().st_size / 1e6:.1f} MB, "
              f"{100 * cover:.0f}% cloud-free")

    (cfg.SITE_DATA / "overlays.json").write_text(json.dumps({
        # Leaflet wants [[south, west], [north, east]].
        "bounds": [[south, west], [north, east]],
        "event": cfg.EVENT,
        "source": "Sentinel-2 L2A, cloud-masked median composite",
        "note": "Both dates share one contrast stretch, computed on the pre-event "
                "image, so a difference in brightness is a difference on the ground.",
        **meta,
    }, indent=1))
    print(f"  overlays.json  bounds {south:.3f},{west:.3f} .. {north:.3f},{east:.3f}")
    print(f"\nDone. Overlays in {cfg.SITE_DATA}")


if __name__ == "__main__":
    main()

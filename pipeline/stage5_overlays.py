"""Stage 5 -- pre/post overlays for the site's before/after slider.

    python pipeline/stage5_overlays.py

Reprojects the Sentinel-2 composites to Web Mercator and writes them as PNGs the
Leaflet map can lay over the terrain, plus the metadata the slider labels itself
with.

Reads   data/raster/slide_pre.tif, slide_post.tif        (stage 1, cloud-masked)
        data/raster/slideraw_pre.tif, slideraw_post.tif  (stage 1, unmasked)
Writes  web/public/data/{slide,slideraw}_{pre,post}.png
        web/public/data/overlays.json            bounds, dates, valid cover

Not the analysis frame. Stage 1 exports these four over SLIDE_ROI -- the
Trishuli at Betrawati and Gerkhu -- on the two dates Copernicus published as its
image of the day for this flood, one acquisition each rather than a median of a
week. The site's before/after is then the same ground on the same dates as the
published picture, and a reader can hold the two side by side.

Two pairs of those same two frames, differing only in whether the cloud mask ran:

- **Without the filter (slideraw).** Every pixel the satellite returned, cloud
  included -- what the instrument actually delivered on the day.
- **With the filter (slide).** The same frames with cloud, shadow and snow
  dropped per pixel by the SCL mask. What the filter removes shows as a
  transparent hole, so the difference between the two pairs is a measure of how
  much of the picture is weather.

Both pairs share one contrast stretch, computed on the *masked* pre-event image,
so switching between them changes what is covered and nothing else. Give them
their own stretches and the unmasked pair renders darker, because bright cloud
drags its percentiles up, and the switch would look like a brightness control.

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


# (id, label, provenance, what the gaps are)
# The last field is the word the slider puts after the valid percentage. Both
# pairs are the same two acquisitions; the only difference is which file stage 1
# wrote them from, so the dates come from config rather than from this table.
SENSORS = (
    # "of pixels kept", not "of the frame": the number sits on a tag beside an
    # image that includes its own cloud, and anything that reads as a clarity
    # figure there will be read as one. This way it contrasts directly with the
    # masked pair's "cloud-free" -- same frame, one keeps everything, one does not.
    ("slideraw", "Without cloud filter",
     "Copernicus Sentinel-2 L2A true colour, every pixel the satellite returned",
     "of pixels kept"),
    ("slide", "With cloud filter",
     "Copernicus Sentinel-2 L2A true colour, cloud, shadow and snow masked out "
     "per pixel",
     "cloud-free"),
)

# The pair whose pre-event image sets the stretch for every pair. The masked one:
# its percentiles are computed on ground rather than on cloud tops.
STRETCH_FROM = "slide"


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

    # One stretch for every image on the slider, computed once on the masked
    # pre-event frame so the percentiles come off ground rather than cloud tops.
    # Before the loop, not inside it: the unmasked pair is listed first, and
    # ordering the switch by an implementation constraint is how that breaks
    # silently the next time someone reorders it.
    ref_arr, ref_profile = s2_rgb(cfg.RASTER / f"{STRETCH_FROM}_pre.tif")
    ref_web, _, _ = to_web_mercator(ref_arr, ref_profile)
    limits = stretch_bounds(ref_web)
    print("shared stretch, from " + STRETCH_FROM + "_pre: "
          + ", ".join(f"{lo:.2f}..{hi:.2f}" for lo, hi in limits))

    meta, bounds = {}, None
    for sid, label, _, cover_word in SENSORS:
        print(f"{label} overlays")
        pre_arr, profile = s2_rgb(cfg.RASTER / f"{sid}_pre.tif")
        post_arr, _ = s2_rgb(cfg.RASTER / f"{sid}_post.tif")

        pre_web, transform, (w, h) = to_web_mercator(pre_arr, profile)
        post_web, _, _ = to_web_mercator(post_arr, profile)
        print(f"  reprojected to {WEB_CRS}: {w} x {h}")

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

        for half, stack, date in (("pre", pre_web, cfg.SLIDE_PRE),
                                  ("post", post_web, cfg.SLIDE_POST)):
            rgba, cover = to_rgba(stack, limits)
            path = cfg.SITE_DATA / f"{sid}_{half}.png"
            save_png(path, rgba)
            meta[f"{sid}_{half}"] = {"date": date,
                                     "valid_pct": round(100 * cover, 1)}
            print(f"  {path.name}  {path.stat().st_size / 1e6:.1f} MB, "
                  f"{100 * cover:.0f}% {cover_word}")

    (cfg.SITE_DATA / "overlays.json").write_text(json.dumps({
        "bounds": bounds,
        "event": cfg.EVENT,
        "sensors": [{"id": sid, "label": label, "source": source, "cover": word}
                    for sid, label, source, word in SENSORS],
        "note": "Both dates share one contrast stretch, computed on the pre-event "
                "image, so a difference in brightness is a difference on the ground.",
        **meta,
    }, indent=1))
    print(f"\nDone. Overlays in {cfg.SITE_DATA}")


if __name__ == "__main__":
    main()

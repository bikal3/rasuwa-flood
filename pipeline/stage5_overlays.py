"""Stage 5 -- pre/post overlays for the site's before/after slider.

    python pipeline/stage5_overlays.py

Reprojects the Sentinel-2 composites to Web Mercator and writes them as WebP images
the Leaflet map can lay over the terrain, plus the metadata the slider labels
itself with.

Reads   data/raster/slide_pre.tif, slide_post.tif        (stage 1, cloud-masked)
        data/raster/slideraw_pre.tif, slideraw_post.tif  (stage 1, unmasked)
Writes  web/public/data/{slide,slideraw}_{pre,post}.webp
        web/public/data/overlays.json            bounds, dates, valid cover
        web/public/share.jpg                     the link-preview card

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

Two things this does that stage 2's plate does not:

- **One fixed tone curve for every frame.** stage2.rgb() percentile-stretches
  each image independently, which is right for looking at one scene and wrong
  for comparing two: half the apparent "change" between them would be the
  normalisation moving, not the ground. tone() is a constant function of
  reflectance, the same for both dates and both pairs, so a pixel that looks
  brighter after really is brighter, and the cloud switch changes what is
  covered and nothing else.
- **EPSG:3857, not UTM.** Leaflet's ImageOverlay stretches an image linearly
  between two corners in Web Mercator. Handing it a UTM raster and lat/lon corners
  puts the pixels in roughly the right place and precisely the wrong one -- the
  error grows across the frame. Reprojecting first makes the linear stretch exact.

Where a composite has no valid pixel the image is transparent rather than filled.
The slider clips both images to the divider, so a gap in the "after" shows as a
gap instead of quietly revealing the "before" underneath it.
"""

import json
import sys
from datetime import date

import numpy as np
import rasterio
from PIL import Image, ImageDraw, ImageFont
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
    """Sentinel-2 true colour.

    SLIDE_ROI is a lat/lon rectangle, so on the UTM grid it sits slightly
    rotated, and Earth Engine fills the corner wedges outside it with 0 rather
    than nodata -- 2.6% of the frame, drawn as black slivers down the edges. No
    real surface reads exactly 0 in all three bands, so those are nodata too.
    """
    arr, profile = read_bands(path, ("B4", "B3", "B2"))
    arr[:, (arr == 0).all(axis=0)] = np.nan
    return arr, profile


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


def tone(stack, mid=0.13, top=3.0, sat=1.2, gamma=1.8, g_off=0.01):
    """Reflectance -> display 0..1: Sentinel Hub's "L2A optimized" true colour.

    https://custom-scripts.sentinel-hub.com/sentinel-2/l2a_optimized/

    It used to be a linear 2-98% stretch per band off the pre-event image. The
    98th percentile there is ~0.13 reflectance -- a green valley -- while the
    fresh deposit on the Trishuli reads 0.15-0.4, so the one thing anyone came
    to see clipped to flat white, and stretching each band separately tinted the
    rest green. This curve rolls highlights off instead of clipping them (0.13
    lands mid-grey, 0.4 is still below white), treats the three bands alike so
    hue survives, and depends on no image, so both dates and both pairs get
    exactly the same mapping.
    """
    a = np.clip(stack / top, 0, 1)
    t = mid / top
    c = a * (a * t - 1) / (a * (2 * t - 1) - t)
    c = ((c + g_off) ** gamma - g_off ** gamma) / ((1 + g_off) ** gamma - g_off ** gamma)
    c = np.clip(c.mean(axis=0) * (1 - sat) + c * sat, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055)


def to_rgba(stack):
    """Tone-map and turn nodata into transparency. -> (h, w, 4) uint8"""
    alpha = np.isfinite(stack).all(axis=0)
    rgb = np.moveaxis(np.nan_to_num(tone(stack)), 0, -1)
    rgba = np.dstack([rgb, alpha.astype("float32")])
    return (rgba * 255).round().astype("uint8"), float(alpha.mean())


def save_webp(path, rgba):
    """Write RGBA as lossy WebP with lossless alpha.

    These files ship in the repo and are fetched whole when the slider opens, so
    their size is the load time. The 8-bit palette PNGs they replace were
    570-780 KB and banded smooth slopes; WebP at quality 85 is ~150-250 KB with
    no palette. Alpha stays exact -- libwebp codes it losslessly by default --
    so a cloud hole is still a hole to the pixel.
    """
    Image.fromarray(rgba, "RGBA").save(path, "WEBP", quality=85, method=6)


def share_card(pre, post, path):
    """The card a chat client shows beside the link: the two unmasked frames of
    the Betrawati confluence side by side, labelled with their dates.

    The image is what the page is about, so the card is the one picture that
    says "flood" at thumbnail size; the terrain plate it replaced was a grey
    hillshade with a red hairline. 1200 x 630 is the og:image shape every client
    crops to, and JPEG keeps it under the ~300 KB past which WhatsApp shows no
    image at all -- smoke.mjs holds it to that.
    """
    w, h = 1200, 630
    half = (w - 4) // 2
    x0 = pre.width // 2 - 330      # the confluence, with the Trishuli running
    y0 = pre.height // 2 - 330     # off the bottom-left corner
    card = Image.new("RGB", (w, h), "white")
    font = ImageFont.load_default(size=30)
    draw = ImageDraw.Draw(card)
    for i, (im, text) in enumerate(
            ((pre, f"Before · {pretty(cfg.SLIDE_PRE)}"),
             (post, f"After · {pretty(cfg.SLIDE_POST)}"))):
        x = i * (w - half)
        card.paste(im.crop((x0, y0, x0 + half, y0 + h)), (x, 0))
        box = draw.textbbox((x + 16, 16), text, font=font)
        draw.rectangle((box[0] - 10, box[1] - 8, box[2] + 10, box[3] + 8), fill="black")
        draw.text((x + 16, 16), text, font=font, fill="white")
    card.save(path, quality=85, optimize=True)


def pretty(iso):
    """'2026-08-12' -> '12 Aug 2026', the way the slider labels it."""
    d = date.fromisoformat(iso)
    return f"{d.day} {d:%b %Y}"


def main():
    needed = [f"{sid}_{half}" for sid, *_ in SENSORS for half in ("pre", "post")]
    missing = [n for n in needed if not (cfg.RASTER / f"{n}.tif").exists()]
    if missing:
        sys.exit(f"Missing {missing} in {cfg.RASTER}. Run stage1_export.py first.")
    cfg.SITE_DATA.mkdir(parents=True, exist_ok=True)

    meta, bounds, frames = {}, None, {}
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
            rgba, cover = to_rgba(stack)
            path = cfg.SITE_DATA / f"{sid}_{half}.webp"
            save_webp(path, rgba)
            frames[f"{sid}_{half}"] = rgba
            meta[f"{sid}_{half}"] = {"date": date,
                                     "valid_pct": round(100 * cover, 1)}
            print(f"  {path.name}  {path.stat().st_size / 1e6:.1f} MB, "
                  f"{100 * cover:.0f}% {cover_word}")

    card = cfg.WEB / "public" / "share.jpg"
    share_card(*(Image.fromarray(frames[f"slideraw_{h}"]).convert("RGB")
                 for h in ("pre", "post")), card)
    print(f"  {card.name}  {card.stat().st_size / 1e3:.0f} KB")

    (cfg.SITE_DATA / "overlays.json").write_text(json.dumps({
        "bounds": bounds,
        "event": cfg.EVENT,
        "sensors": [{"id": sid, "label": label, "source": source, "cover": word}
                    for sid, label, source, word in SENSORS],
        "note": "Every frame goes through one fixed tone curve, so a difference in "
                "brightness is a difference on the ground.",
        **meta,
    }, indent=1))
    print(f"\nDone. Overlays in {cfg.SITE_DATA}")


if __name__ == "__main__":
    main()

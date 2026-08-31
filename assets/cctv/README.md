# CCTV demo clips

Drop the 4 demo feed files here:

```
cam_01.mp4   Junction – Market St   (lock-on point)
cam_02.mp4   Overpass – North       (first handoff)
cam_03.mp4   Alley – East Lane      (branch / "other route")
cam_04.mp4   Transit Hub – Plaza    (reconverge)
```

These paths are already seeded into the `cameras.feed_uri` column by
`tools/seed_cctv.py`. The engine (`engine/cv/stream.py`) opens them with
`cv2.VideoCapture(feed_uri)`.

**For the demo:** use one continuous pedestrian clip of the same person and cut
it into 4 segments (cam_01 → cam_02 → cam_04 in order, with cam_03 as an
alternate route), so lock-on → topology handoff → re-sighting reads as one
chase. Any resolution; short loops (10–30s) are fine.

The `.mp4` files are gitignored (large binaries) — only this README is tracked.

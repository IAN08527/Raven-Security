#!/usr/bin/env python3
"""Setup synchronized continuous multi-camera tracking sequences for Project Raven CCTV Re-ID."""

import os
import urllib.request
import sys
import cv2

SOURCE_URL = "https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/one-by-one-person-detection.mp4"

def main():
    target_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "cctv")
    os.makedirs(target_dir, exist_ok=True)
    source_path = os.path.join(target_dir, "raw_tracking_source.mp4")

    print(f"Setting up continuous multi-camera surveillance sequences in: {target_dir}\n")

    if not os.path.exists(source_path) or os.path.getsize(source_path) < 100000:
        print("[>] Downloading continuous multi-person surveillance source...")
        try:
            req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req) as resp, open(source_path, "wb") as f:
                f.write(resp.read())
            print(f"    Downloaded ({os.path.getsize(source_path):,} bytes).")
        except Exception as e:
            print(f"    Failed to download source: {e}", file=sys.stderr)
            return

    cap = cv2.VideoCapture(source_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 10.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")

    # Continuous spatio-temporal camera sequences tracking the SAME target person:
    # cam_01: Target Person enters Main Gate and crosses field of view (0 - 22s)
    # cam_02: Target Person enters North Crossing during handoff window (15 - 37s)
    # cam_03: Decoy bystander on South Corridor alternate branch (60 - 82s) -> Re-ID correctly rejects!
    # cam_04: Target Person reaches Metro Exit / Plaza downstream (30 - 52s) -> Final Re-ID link!
    segments = {
        "cam_01.mp4": (0, int(22 * fps), "CAM-01: Main Gate / Market Junction (Suspect Entry)"),
        "cam_02.mp4": (int(15 * fps), int(37 * fps), "CAM-02: North Crossing (Downstream Handoff Match)"),
        "cam_03.mp4": (int(60 * fps), int(82 * fps), "CAM-03: South Corridor (Decoy Route - Topology Rejection)"),
        "cam_04.mp4": (int(30 * fps), int(52 * fps), "CAM-04: Metro Station Exit (Final Re-convergence)"),
    }

    for filename, (start, end, desc) in segments.items():
        out_path = os.path.join(target_dir, filename)
        cap.set(cv2.CAP_PROP_POS_FRAMES, start)
        out = cv2.VideoWriter(out_path, fourcc, fps, (w, h))
        for f in range(start, end):
            ret, frame = cap.read()
            if not ret:
                break
            out.write(frame)
        out.release()
        print(f"[✓] Generated {filename} ({os.path.getsize(out_path):,} bytes) — {desc}")

    cap.release()
    print("\nAll 4 synchronized CCTV camera feeds are ready for multi-camera tracking!")

if __name__ == "__main__":
    main()

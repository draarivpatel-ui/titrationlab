#!/usr/bin/env python3
"""Scale synthesized narration into the 60-75 second demo window and retime its manifest."""
import json
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VIDEO = REPO / "video"
WAV = VIDEO / "narration.wav"
MANIFEST = VIDEO / "manifest.json"
TEMPO = 1.15
VOLUME = 0.88


def main():
    manifest = json.loads(MANIFEST.read_text())
    if manifest.get("tempo_scale") == TEMPO:
        print(f"already scaled by {TEMPO}; total {manifest['total']}")
        return
    natural = VIDEO / "narration-natural-input.wav"
    WAV.replace(natural)
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-i", str(natural),
            "-af", f"atempo={TEMPO},volume={VOLUME}",
            "-c:a", "pcm_s16le", str(WAV),
        ],
        check=True,
    )
    scale = 1 / TEMPO
    manifest["tempo_scale"] = TEMPO
    manifest["volume_scale"] = VOLUME
    manifest["natural_total"] = manifest["total"]
    manifest["total"] = round(manifest["total"] * scale, 3)
    for entry in manifest["sentences"]:
        entry["natural_start"] = entry["start"]
        entry["natural_dur"] = entry["dur"]
        entry["start"] = round(entry["start"] * scale, 3)
        entry["dur"] = round(entry["dur"] * scale, 3)
    MANIFEST.write_text(json.dumps(manifest, indent=1))
    natural.unlink()
    print(f"scaled total {manifest['total']}")


if __name__ == "__main__":
    main()

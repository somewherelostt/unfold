"""Build SfxItem[] manifest from library/sfx-sources.local.tsv (gitignored) + the trimmed mp3s.
Usage: python scripts/build_sfx_manifest.py <sources.local.tsv> <sfx_dir> <manifest.json>"""
import json, subprocess, sys
from pathlib import Path

src, d, out = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
items = []
for line in open(src):
    if line.startswith("#") or not line.strip():
        continue
    sid, name, author, _cdn, slug, tags = line.rstrip("\n").split("\t")
    f = d / f"{sid}.mp3"
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)]).strip())
    items.append({
        "id": sid, "name": name, "url": f"/assets/sfx/{sid}.mp3", "durationSec": round(dur, 3),
        "tags": tags.split(","),
        "source": "library",
        "license": "Royalty-free library licence: free commercial use, no attribution required",
    })
Path(out).write_text(json.dumps(items, indent=1))
print(f"wrote {len(items)} sfx -> {out}")

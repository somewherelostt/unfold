"""Analyse music tracks -> MusicTrack[] manifest (packages/core schema).

Usage: .venv/bin/python scripts/analyze_music.py <sources.local.tsv> <music_dir> <manifest.json>

For each track: BPM + beat times (dynamic-programming beat tracker), downbeats (every 4th beat, phase chosen
by the strongest low-frequency onset), drop (biggest sustained energy rise), overall energy 0..1.
"""
import csv
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import librosa as dsp  # audio analysis package (see requirements.txt)

SR = 22050
HOP = 512


def fold_bpm(bpm: float) -> float:
    # Keep tempos in the 75-165 range editors expect (the beat tracker sometimes halves/doubles).
    while bpm < 75:
        bpm *= 2
    while bpm > 165:
        bpm /= 2
    return bpm


def analyse(path: str) -> dict:
    y, sr = dsp.load(path, sr=SR, mono=True)
    dur = len(y) / sr
    onset_env = dsp.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    tempo, beat_frames = dsp.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=HOP, units="frames")
    tempo = float(np.atleast_1d(tempo)[0])
    beats = dsp.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    bpm = fold_bpm(tempo) if tempo > 0 else 0.0
    # If the tracker locked at half/double tempo, resample the beat grid accordingly.
    if tempo > 0 and abs(bpm - tempo) > 1 and len(beats) > 2:
        ratio = bpm / tempo
        if ratio > 1:  # double: insert midpoints
            mids = (beats[:-1] + beats[1:]) / 2
            beats = np.sort(np.concatenate([beats, mids]))
        else:  # halve
            beats = beats[::2]

    # Downbeats: bass-band onset strength sampled at beats; pick the phase (0..3) with max energy.
    S = np.abs(dsp.stft(y, hop_length=HOP))
    freqs = dsp.fft_frequencies(sr=sr)
    low = S[freqs < 200].sum(axis=0)
    beat_idx = np.clip(dsp.time_to_frames(beats, sr=sr, hop_length=HOP), 0, len(low) - 1)
    downbeats = []
    if len(beats) >= 8:
        vals = low[beat_idx]
        phase = int(np.argmax([vals[p::4].mean() for p in range(4)]))
        downbeats = beats[phase::4]

    # Energy envelope (RMS, ~2Hz smoothing) -> drop = largest rise between 4s windows.
    rms = dsp.feature.rms(y=y, hop_length=HOP)[0]
    fps = sr / HOP
    win = max(1, int(fps * 4))
    smooth = np.convolve(rms, np.ones(win) / win, mode="same")
    drop_at = None
    if len(smooth) > 2 * win:
        rise = smooth[win:] - smooth[:-win]  # energy now vs 4s ago
        # ignore first 3s / last 5s
        lo, hi = int(fps * 3), len(rise) - int(fps * 5)
        if hi > lo:
            i = lo + int(np.argmax(rise[lo:hi])) + win // 2
            t = i / fps
            # snap to nearest downbeat (else beat)
            grid = downbeats if len(downbeats) else beats
            if len(grid):
                t = float(grid[np.argmin(np.abs(grid - t))])
            drop_at = round(t, 3)

    # Energy: loudness + onset density + tempo, squashed to 0..1.
    rms_db = 20 * np.log10(np.mean(rms) + 1e-9)
    loud = np.clip((rms_db + 30) / 22, 0, 1)  # -30dBFS..-8dBFS
    onset_rate = np.clip(np.mean(onset_env) / 2.5, 0, 1)
    tempo_n = np.clip((bpm - 70) / 90, 0, 1)
    energy = float(np.clip(0.5 * loud + 0.3 * onset_rate + 0.2 * tempo_n, 0, 1))

    return {
        "durationSec": round(dur, 3),
        "bpm": round(bpm, 1),
        "beats": [round(float(b), 3) for b in beats],
        "downbeats": [round(float(b), 3) for b in downbeats],
        "dropAt": drop_at,
        "energy": round(energy, 3),
    }


def main():
    src, music_dir, out = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
    rows = []
    with open(src) as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            rows.append(line.rstrip("\n").split("\t"))
    paths = [str(music_dir / f"{r[0]}.mp3") for r in rows]
    with ProcessPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(analyse, paths))
    manifest = []
    for r, a in zip(rows, results):
        tid, title, artist, _cdn, _slug, moods, genres, _cid = r
        manifest.append({
            "id": tid,
            "title": title,
            "artist": artist,
            "url": f"/assets/music/{tid}.mp3",
            **a,
            "moods": moods.split(","),
            "genres": genres.split(","),
            "source": "library",
            "sourceUrl": "",  # page links stay in the gitignored local source list
        })
        print(f"{tid:28s} bpm={a['bpm']:6.1f} drop={a['dropAt']} energy={a['energy']:.2f} dur={a['durationSec']}", file=sys.stderr)
    Path(out).write_text(json.dumps(manifest, indent=1))
    print(f"wrote {len(manifest)} tracks -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()

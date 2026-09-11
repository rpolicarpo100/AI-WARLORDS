#!/usr/bin/env python3
"""Synthesize the Vale of Echoes SFX pack (Audacity-style output, zero deps).

Generates 22050 Hz 8-bit mono WAVs: click, coin (gather), step (move),
hammer (build), whoosh (advance), fanfare (upgrade/victory), wind (ambience),
clash (melee), twang (bow), horn (killing blow).
Run: python3 assets/sfx.py  ->  assets/sfx/*.wav
"""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).parent / "sfx"


def env(i, n, attack=0.05, decay=0.4):
    t = i / n
    a = min(1.0, t / attack) if attack > 0 else 1.0
    d = max(0.0, 1.0 - (t / decay)) if decay > 0 else 1.0
    return min(a, d)


def tone(freq, dur, vol=0.7, slide=0.0, wave_fn=math.sin, attack=0.05, decay=0.5):
    n = int(RATE * dur)
    out = []
    for i in range(n):
        f = freq * (1.0 + slide * (i / n))
        v = wave_fn(2 * math.pi * f * i / RATE) * vol * env(i, n, attack, decay)
        out.append(v)
    return out


def noise(dur, vol=0.5, lowpass=0.2, attack=0.02, decay=0.5):
    n = int(RATE * dur)
    out, last = [], 0.0
    for i in range(n):
        last = last * (1 - lowpass) + random.uniform(-1, 1) * lowpass
        out.append(last * vol * env(i, n, attack, decay))
    return out


def mix(*tracks):
    n = max(len(t) for t in tracks)
    out = [0.0] * n
    for t in tracks:
        for i, v in enumerate(t):
            out[i] += v
    peak = max(1.0, max(abs(v) for v in out))
    return [v / peak for v in out]


def at(track, offset_sec):
    return [0.0] * int(RATE * offset_sec) + track


def save(name, samples):
    OUT.mkdir(exist_ok=True)
    pcm = struct.pack(
        f"{len(samples)}B",
        *(max(0, min(255, int(128 + v * 120))) for v in samples),
    )
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(RATE)
        w.writeframes(pcm)
    print(f"{name}.wav: {len(samples)/RATE:.2f}s, {len(pcm)} bytes")


def main():
    random.seed(7)
    save("click", tone(880, 0.06, vol=0.5, slide=-0.4, decay=0.9))
    save("coin", mix(tone(1320, 0.09, decay=0.9), at(tone(1760, 0.16, decay=0.7), 0.08)))
    save("step", mix(noise(0.1, vol=0.8, lowpass=0.12), tone(140, 0.1, vol=0.5, slide=-0.5)))
    save(
        "hammer",
        mix(
            at(mix(noise(0.06, vol=0.9, lowpass=0.3), tone(220, 0.08, slide=-0.3)), 0.0),
            at(mix(noise(0.06, vol=0.9, lowpass=0.3), tone(196, 0.1, slide=-0.3)), 0.16),
        ),
    )
    save(
        "whoosh",
        [v * math.sin(math.pi * i / int(RATE * 0.35)) for i, v in enumerate(noise(0.35, vol=0.9, lowpass=0.06, attack=1.0, decay=1.0))],
    )
    wind = noise(3.0, vol=0.9, lowpass=0.05, attack=1.0, decay=1.0)
    swell = [v * (0.45 + 0.35 * math.sin(2 * math.pi * i / len(wind) * 2 + 1)) for i, v in enumerate(wind)]
    chirps = mix(
        at(tone(2500, 0.1, vol=0.25, slide=0.35, decay=0.9), 0.6),
        at(tone(2900, 0.09, vol=0.22, slide=-0.25, decay=0.9), 0.78),
        at(tone(2700, 0.12, vol=0.24, slide=0.3, decay=0.9), 2.0),
    )
    save("wind", mix(swell, chirps))
    save(
        "clash",
        mix(
            noise(0.14, vol=0.8, lowpass=0.55, attack=0.005, decay=0.9),
            tone(2093, 0.16, vol=0.4, decay=0.92),
            tone(1567, 0.14, vol=0.35, decay=0.92),
            tone(2873, 0.1, vol=0.25, decay=0.95),
        ),
    )
    save(
        "twang",
        mix(
            tone(190, 0.12, vol=0.7, slide=-0.35, decay=0.9),
            tone(540, 0.09, vol=0.4, slide=-0.55, decay=0.9),
            noise(0.03, vol=0.5, lowpass=0.6, decay=0.95),
        ),
    )
    saw = lambda ph: 2 * ((ph / (2 * math.pi)) % 1.0) - 1.0
    save(
        "horn",
        mix(
            tone(98, 0.7, vol=0.55, wave_fn=saw, attack=0.12, decay=0.35),
            tone(147, 0.7, vol=0.35, wave_fn=saw, attack=0.14, decay=0.3),
            tone(196, 0.5, vol=0.2, attack=0.15, decay=0.4),
        ),
    )
    save(
        "fanfare",
        mix(
            *[at(tone(f, 0.22, vol=0.6, decay=0.6), i * 0.13) for i, f in enumerate([523, 659, 784, 1047])],
            at(tone(1319, 0.4, vol=0.5, decay=0.4), 0.52),
        ),
    )


if __name__ == "__main__":
    main()

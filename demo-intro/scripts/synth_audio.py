"""Procedural sound design for the FocusPlug intro hook.

Outputs (44.1kHz stereo WAV, into assets/):
  assets/bed.wav      12.6s tension bed: sub drone + accelerating clock ticks
                      + heartbeat pulse + noise riser. Hard-cut at 12.6s.
  assets/boom.wav     1.6s low cinematic boom for the FOCUS reveal.
  assets/static_a.wav / static_b.wav / static_c.wav
                      ~0.15s TV-static channel-switch bursts (3 variants).
Deterministic: fixed RNG seed.
"""
import numpy as np
import soundfile as sf
import os

SR = 44100
rng = np.random.default_rng(47)  # 47 seconds — of course
OUT = os.path.join(os.path.dirname(__file__), "..", "assets")


def env_exp(n, tau):
    return np.exp(-np.arange(n) / (SR * tau))


def soft_clip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def fft_bandpass(x, lo, hi, sr=SR):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / sr)
    mask = np.ones_like(f)
    # smooth 12dB/oct-ish shoulders instead of brick wall
    mask[f < lo] = (f[f < lo] / max(lo, 1e-9)) ** 2
    mask[f > hi] = np.where(f[f > hi] > 1e-9, (hi / f[f > hi]) ** 2, 0)
    return np.fft.irfft(X * mask, n=len(x))


# ---------------------------------------------------------------- bed (12.6s)
DUR = 12.6
N = int(SR * DUR)
t = np.arange(N) / SR
bed = np.zeros(N)

# 1) Sub drone: detuned 55Hz pair, slowly swelling
drone = 0.5 * np.sin(2 * np.pi * 55.0 * t) + 0.5 * np.sin(2 * np.pi * 55.45 * t + 0.7)
drone += 0.25 * np.sin(2 * np.pi * 110.2 * t + 1.1)
swell = 0.10 + 0.16 * (t / DUR) ** 1.5
bed += drone * swell

# 2) Dark air: brown noise, low-passed, faint
brown = np.cumsum(rng.standard_normal(N))
brown /= np.max(np.abs(brown))
air = fft_bandpass(brown, 60, 420)
air /= max(np.max(np.abs(air)), 1e-9)
bed += air * (0.035 + 0.05 * (t / DUR) ** 2)

# 3) Accelerating clock ticks (the motif): interval 0.72s -> 0.16s
ticks = np.zeros(N)
tick_times = []
tt, interval = 0.35, 0.72
while tt < DUR - 0.02:
    tick_times.append(tt)
    frac = tt / DUR
    interval = 0.72 * (1 - frac) + 0.16 * frac
    tt += interval
for i, tt in enumerate(tick_times):
    n0 = int(tt * SR)
    ln = int(0.030 * SR)
    if n0 + ln >= N:
        break
    freq = 2050.0 if i % 2 == 0 else 1660.0  # tick / tock
    burst = np.sin(2 * np.pi * freq * np.arange(ln) / SR) * env_exp(ln, 0.006)
    click = rng.standard_normal(ln) * env_exp(ln, 0.0025) * 0.6
    body = fft_bandpass(burst + click, 900, 6000)
    loud = 0.10 + 0.13 * (tt / DUR) ** 1.3
    ticks[n0:n0 + ln] += body * loud
bed += ticks

# 4) Heartbeat pulse: pitch-dropping thump on an accelerating half-grid
pulse = np.zeros(N)
pt = 0.0
while pt < DUR - 0.05:
    frac = pt / DUR
    n0 = int(pt * SR)
    ln = int(0.22 * SR)
    if n0 + ln >= N:
        break
    tp = np.arange(ln) / SR
    f0, f1 = 96.0, 44.0
    ph = 2 * np.pi * (f0 * tp + (f1 - f0) * tp**2 / (2 * 0.22))
    thump = np.sin(ph) * env_exp(ln, 0.055)
    pulse[n0:n0 + ln] += thump * (0.22 + 0.3 * frac)
    step = 1.44 * (1 - frac) + 0.36 * frac
    pt += step
bed += soft_clip(pulse, 1.4) * 0.9

# 5) Noise riser 9.4s -> 12.6s: bandpass sweeping up + volume ramp
rise_start = 9.4
rn = N - int(rise_start * SR)
white = rng.standard_normal(rn)
riser = np.zeros(rn)
seg = int(0.1 * SR)
for k in range(0, rn, seg):
    fr = k / rn
    lo = 300 + 2500 * fr**1.6
    hi = 1400 + 9000 * fr**1.4
    chunk = white[k:k + seg]
    riser[k:k + seg] = fft_bandpass(chunk, lo, hi)
riser /= max(np.max(np.abs(riser)), 1e-9)
ramp = (np.arange(rn) / rn) ** 2.2
bed[int(rise_start * SR):] += riser * ramp * 0.34
# rising shepard-ish sine under the riser
tr = np.arange(rn) / SR
bed[int(rise_start * SR):] += np.sin(2 * np.pi * (110 * tr + (250 * tr**2) / (2 * (rn / SR)))) * ramp * 0.10

# master: gentle drive, hard cut (no fade — the cut IS the beat), tiny 3ms declick
bed = soft_clip(bed, 1.2) * 0.85
dc = int(0.003 * SR)
bed[-dc:] *= np.linspace(1, 0, dc)
st = np.stack([bed, bed], axis=1)
# subtle stereo: decorrelate air/ticks with 0.4ms delay on right
d = int(0.0004 * SR)
st[d:, 1] = 0.75 * st[d:, 1] + 0.25 * np.roll(bed, d)[d:]
sf.write(os.path.join(OUT, "bed.wav"), st.astype(np.float32), SR)

# ---------------------------------------------------------------- boom (1.6s)
BN = int(1.6 * SR)
tb = np.arange(BN) / SR
f0, f1 = 68.0, 38.0
ph = 2 * np.pi * (f0 * tb + (f1 - f0) * tb**2 / (2 * 1.6))
boom = np.sin(ph) * env_exp(BN, 0.42)
boom += 0.5 * np.sin(0.5 * ph) * env_exp(BN, 0.5)
nb = fft_bandpass(rng.standard_normal(BN), 40, 900) * env_exp(BN, 0.06)
boom += nb * 0.5
boom = soft_clip(boom, 1.6) * 0.9
boom[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
sf.write(os.path.join(OUT, "boom.wav"), np.stack([boom, boom], 1).astype(np.float32), SR)

# ------------------------------------------------------- static bursts (x3)
for name, ln_s, lo, hi, crackle in [
    ("static_a", 0.16, 800, 12000, 30),
    ("static_b", 0.13, 500, 9000, 18),
    ("static_c", 0.11, 1200, 14000, 42),
]:
    ln = int(ln_s * SR)
    noise = rng.standard_normal(ln)
    x = fft_bandpass(noise, lo, hi)
    x /= max(np.max(np.abs(x)), 1e-9)
    # crackle impulses
    for _ in range(crackle):
        p = rng.integers(0, ln - 40)
        x[p:p + 40] += rng.standard_normal(40) * 1.6 * env_exp(40, 0.0004)
    # sharp attack, fast decay tail
    envl = np.ones(ln)
    a = int(0.004 * SR)
    envl[:a] = np.linspace(0, 1, a)
    dcy = int(0.05 * SR)
    envl[-dcy:] *= np.linspace(1, 0, dcy) ** 1.5
    x = soft_clip(x * envl, 2.2) * 0.8
    l = x
    r = np.roll(x, int(0.0006 * SR))
    sf.write(os.path.join(OUT, f"{name}.wav"), np.stack([l, r], 1).astype(np.float32), SR)

print("synth done:", sorted(os.listdir(OUT)))

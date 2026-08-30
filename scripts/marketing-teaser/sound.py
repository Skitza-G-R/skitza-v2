"""Skitza teaser — UI sound design, synthesized from scratch.

Every cue is pitched inside A-minor pentatonic so it sits under a music bed
without clashing. Levels are deliberately conservative: this is a sound-effects
stem meant to be mixed *beneath* a track, not a finished master.
"""
import json, wave, sys
import numpy as np

TIMELINE = sys.argv[1] if len(sys.argv) > 1 else 'timeline-real.json'
OUTPUT   = sys.argv[2] if len(sys.argv) > 2 else 'sfx.wav'

SR = 48_000
rng = np.random.default_rng(20260829)

# A-minor pentatonic, the safe set to tune UI cues to
A3, C4, D4, E4, G4 = 220.00, 261.63, 293.66, 329.63, 392.00
A4, C5, D5, E5, G5, A5 = 440.00, 523.25, 587.33, 659.25, 783.99, 880.00


def t(n):                       return np.arange(int(n * SR)) / SR
def env_exp(x, k):              return np.exp(-x * k)
def env_ar(x, a, r):
    """attack/release envelope without the click of a hard start"""
    return np.minimum(np.clip(x / max(a, 1e-6), 0, 1),
                      np.exp(-np.maximum(x - a, 0) * r))

def spectral(sig, lo=None, hi=None, tilt=0.0):
    """FFT-domain filter — fast, and avoids an IIR loop in Python."""
    S = np.fft.rfft(sig)
    f = np.fft.rfftfreq(len(sig), 1 / SR)
    g = np.ones_like(f)
    if lo is not None: g *= 1 / (1 + (lo / np.maximum(f, 1e-9)) ** 4)     # highpass
    if hi is not None: g *= 1 / (1 + (np.maximum(f, 1e-9) / hi) ** 4)     # lowpass
    if tilt:           g *= (np.maximum(f, 20) / 1000.0) ** tilt
    return np.fft.irfft(S * g, n=len(sig))

def noise(n):   return rng.normal(0, 1, int(n * SR))
def sine(f, x, ph=0.0):
    f = np.asarray(f, dtype=float)
    if f.ndim == 0: return np.sin(2 * np.pi * f * x + ph)
    return np.sin(2 * np.pi * np.cumsum(f) / SR + ph)   # f as per-sample sweep


# ----------------------------------------------------------------- cues
def s_tick():
    x = t(0.05)
    return (sine(2600, x) * 0.5 + sine(3900, x) * 0.2) * env_exp(x, 150) * 0.30

def s_click():
    x = t(0.09)
    body = sine(1750, x) * 0.55 + sine(2650, x) * 0.25
    air  = spectral(noise(0.09), lo=1800, hi=9000) * 0.32
    return (body + air) * env_exp(x, 78) * 0.55

def s_pop():
    x = t(0.16)
    sweep = np.linspace(920, 380, len(x))
    return sine(sweep, x) * env_ar(x, 0.004, 34) * 0.42

def s_confirm():
    x = t(0.34)
    a = sine(C5, x) * env_ar(x, 0.006, 15)
    b = np.concatenate([np.zeros(int(0.075 * SR)),
                        (sine(E5, t(0.265)) * env_ar(t(0.265), 0.006, 14))])[:len(x)]
    return (a + b) * 0.30

def s_success():
    """rising C-E-G — the 'it worked' moment"""
    out = np.zeros(int(0.75 * SR))
    for i, f in enumerate([C5, E5, G5]):
        d, off = 0.55, int(i * 0.085 * SR)
        x = t(d)
        v = (sine(f, x) * 0.6 + sine(f * 2, x) * 0.16) * env_ar(x, 0.008, 9)
        out[off:off + len(v)] += v[:len(out) - off]
    return out * 0.34

def s_whoosh():
    x  = t(0.42)
    nz = spectral(noise(0.42), lo=420, hi=6200)
    sw = np.sin(np.pi * np.clip(x / 0.42, 0, 1)) ** 1.5        # swell in and out
    return nz * sw * 0.30

def s_impact():
    x    = t(0.70)
    drop = np.linspace(115, 44, len(x))
    sub  = sine(drop, x) * env_exp(x, 7.0) * 0.95
    body = spectral(noise(0.70), hi=1400) * env_exp(x, 26) * 0.30
    return (sub + body) * 0.52

def s_riser():
    x  = t(1.30)
    up = np.linspace(180, 1150, len(x))
    tn = sine(up, x) * 0.30
    nz = spectral(noise(1.30), lo=600, hi=7000) * 0.34
    return (tn + nz) * (np.clip(x / 1.30, 0, 1) ** 2.1) * 0.30

def s_upload():
    x  = t(0.55)
    up = np.linspace(430, 880, len(x))
    trem = 0.82 + 0.18 * np.sin(2 * np.pi * 15 * x)
    return sine(up, x) * env_ar(x, 0.02, 6.5) * trem * 0.26

def s_buzz():
    """short phone-vibration burr — the hook's message spam"""
    x = t(0.09)
    tone = np.sign(np.sin(2 * np.pi * 165 * x)) * 0.5 + np.sin(2 * np.pi * 82 * x) * 0.4
    tone = spectral(tone, hi=900)
    return tone * env_ar(x, 0.004, 40) * 0.34


def s_unlock():
    """two mechanical clicks, then the latch opens on a rising fifth"""
    out = np.zeros(int(0.62 * SR))
    for off in (0.0, 0.055):
        c = s_click() * 0.75
        i = int(off * SR); out[i:i + len(c)] += c[:len(out) - i]
    x = t(0.45); i = int(0.10 * SR)
    tone = (sine(A4, x) * 0.5 + sine(E5, x) * 0.34) * env_ar(x, 0.01, 8)
    out[i:i + len(tone)] += tone[:len(out) - i] * 0.42
    return out * 0.62


CUES = { 'tick':s_tick, 'click':s_click, 'pop':s_pop, 'confirm':s_confirm, 'buzz':s_buzz,
         'success':s_success, 'whoosh':s_whoosh, 'impact':s_impact,
         'riser':s_riser, 'upload':s_upload, 'unlock':s_unlock }


def main():
    tl    = json.load(open(TIMELINE))
    total = max(b['start'] + b['dur'] for b in tl['beats'])
    n     = int((total + 1.0) * SR)
    L     = np.zeros(n); R = np.zeros(n)

    cache = {k: f() for k, f in CUES.items()}
    placed = 0
    for ev in tl['sound']:
        cue = cache.get(ev['s'])
        if cue is None:
            print(f"  ! unknown cue {ev['s']!r}", file=sys.stderr); continue
        g = float(ev.get('g', 1.0))
        i = int(float(ev['t']) * SR)
        seg = cue[:max(0, n - i)]
        if not len(seg): continue
        # gentle stereo placement: whooshes sweep, everything else sits near centre
        if ev['s'] == 'whoosh':
            pan = np.linspace(-0.75, 0.75, len(seg))
        else:
            pan = np.full(len(seg), (hash(ev['s']) % 100 / 100.0 - 0.5) * 0.30)
        L[i:i + len(seg)] += seg * g * np.cos((pan + 1) * np.pi / 4)
        R[i:i + len(seg)] += seg * g * np.sin((pan + 1) * np.pi / 4)
        placed += 1

    st = np.stack([L, R], axis=1)
    # soft-knee limiter, then leave clear headroom for the music bed
    st = np.tanh(st * 1.12) * 0.92
    peak = float(np.max(np.abs(st))) or 1.0
    st = st / peak * 0.72

    # 8 ms fades so the stem never clicks at the boundaries
    f = int(0.008 * SR)
    st[:f] *= np.linspace(0, 1, f)[:, None]
    st[-f:] *= np.linspace(1, 0, f)[:, None]

    with wave.open(OUTPUT, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(st, -1, 1) * 32767).astype('<i2').tobytes())

    print(f"{OUTPUT} — {placed} cues placed, {n/SR:.2f}s, peak {20*np.log10(0.72):.1f} dBFS")


if __name__ == '__main__':
    main()

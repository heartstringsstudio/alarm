"""Generates the extra wake-up sounds in sounds/ (original, code-made audio).
Run:  python3 tools/make-sounds.py   (needs numpy + ffmpeg)
Melodies used (Amazing Grace / "New Britain", Silent Night) are public domain."""
import os, subprocess, tempfile, wave
import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds')
rng = np.random.default_rng(7)

def hz(note):
    names = {'C': -9, 'D': -7, 'E': -5, 'F': -4, 'G': -2, 'A': 0, 'B': 2}
    n, octave = note[:-1], int(note[-1])
    semis = names[n[0]] + (1 if '#' in n else -1 if n.endswith('b') and len(n) > 1 else 0)
    return 440.0 * 2 ** ((semis + (octave - 4) * 12) / 12)

def env(n, attack, decay):
    t = np.arange(n) / SR
    e = np.exp(-t / decay)
    a = max(1, int(attack * SR))
    e[:a] *= np.linspace(0, 1, a)
    return e

def partials(freq, dur, ratios, amps, decays, attack=0.004):
    n = int(dur * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for r, a, d in zip(ratios, amps, decays):
        out += a * np.sin(2 * np.pi * freq * r * t + rng.uniform(0, 6.28)) * env(n, attack, d)
    return out

def pluck(freq, dur, bright=0.5, decay=None):
    """Plucked string built from exact harmonics, so every note is in tune."""
    n = int(dur * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for k in range(1, 9):
        if freq * k > SR / 2.2: break
        amp = (1 / k ** (2.1 - bright * 1.4)) * (1 if k % 2 else 0.8)
        out += amp * np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (0.9 + 0.55 * k))
    click = rng.normal(0, 1, min(n, int(0.006 * SR))) * np.linspace(0.25, 0, min(n, int(0.006 * SR)))
    out[:len(click)] += click
    return out * env(n, 0.002, 6.0)

def reverb(x, seconds=1.4, mix=0.25):
    n = int(seconds * SR)
    ir = rng.normal(0, 1, n) * np.exp(-np.arange(n) / SR / (seconds / 5))
    ir[0] = 0
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:len(x) + n]
    wet /= np.max(np.abs(wet)) + 1e-9
    dry = np.concatenate([x, np.zeros(n)]) / (np.max(np.abs(x)) + 1e-9)
    return (1 - mix) * dry + mix * wet

def place(track, sound, at):
    i = int(at * SR); end = min(len(track), i + len(sound))
    track[i:end] += sound[:end - i]

def finish(x, total, name, fade_out=1.2):
    x = reverb(x)[:int(total * SR)]
    f = int(fade_out * SR); x[-f:] *= np.linspace(1, 0, f)
    x = x / np.max(np.abs(x)) * 0.89
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    dst = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', '128k', dst], check=True)
    os.unlink(tmp); print('wrote', os.path.relpath(dst))

def melody(notes, beat, voice, total):
    track = np.zeros(int((total + 3) * SR)); t = 0.6
    for note, beats in notes:
        if note: place(track, voice(hz(note), beats * beat), t)
        t += beats * beat
    return track

# 1. Mountain dulcimer — Amazing Grace, first line (3/4)
grace = [('D4', 1), ('G4', 2), ('B4', .5), ('G4', .5), ('B4', 2), ('A4', 1), ('G4', 2), ('E4', 1),
         ('D4', 2), ('D4', 1), ('G4', 2), ('B4', .5), ('G4', .5), ('B4', 2), ('A4', 1), ('D5', 3)]
def dulcimer(f, d):
    return pluck(f, d + 1.6, bright=0.6)
tune = melody(grace, 0.42, dulcimer, 11)
drone = 0.18 * partials(hz('D3'), len(tune) / SR, [1, 2, 3], [1, .5, .25], [9, 6, 4], attack=0.3)   # dulcimer drone string
finish(tune + drone[:len(tune)], 11.5, 'dulcimer')

# 2. Music box — Silent Night, first line (6/8)
silent = [('G5', 1.5), ('A5', .5), ('G5', 1), ('E5', 3), ('G5', 1.5), ('A5', .5), ('G5', 1), ('E5', 3),
          ('D6', 2), ('D6', 1), ('B5', 3), ('C6', 2), ('C6', 1), ('G5', 3)]
def musicbox(f, d):
    return partials(f, 2.6, [1, 3.0, 5.4, 8.9], [1, .35, .12, .05], [1.1, .4, .18, .08], attack=0.002)
finish(melody(silent, 0.26, musicbox, 7.6), 8.2, 'musicbox')

# 3. Singing bowl — two soft strikes, long shimmer
bowl = np.zeros(int(12 * SR))
for at, amp in [(0.3, 1.0), (4.2, 0.8)]:
    f = hz('A3') * 0.98
    s = partials(f, 7.5, [1, 1.006, 2.71, 2.722, 5.1, 8.2], [1, .8, .5, .4, .18, .06], [5, 5, 3.2, 3.2, 1.4, .6], attack=0.01)
    place(bowl, amp * s, at)
finish(bowl, 9.5, 'bowl', fade_out=2.5)

# 4. Morning harp — rising G-major arpeggio, twice
harp_notes = ['G3', 'B3', 'D4', 'G4', 'B4', 'D5', 'G5', 'B5']
harp = np.zeros(int(10 * SR))
for rep, base in enumerate([0.3, 3.3]):
    for i, n in enumerate(harp_notes):
        place(harp, (0.9 - 0.25 * rep) * pluck(hz(n), 3.5, bright=0.35, decay=0.9985), base + i * 0.17)
place(harp, 0.7 * pluck(hz('G2'), 4.5, 0.3, 0.999), 6.3)
place(harp, 0.6 * pluck(hz('D5'), 3.5, 0.35, 0.9985), 6.32)
place(harp, 0.6 * pluck(hz('G5'), 3.5, 0.35, 0.9985), 6.5)
finish(harp, 9.5, 'harp', fade_out=2.0)

# 5. Porch wind chimes — pentatonic tubes, gentle breeze
pent = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6']
chimes = np.zeros(int(10 * SR)); t = 0.2
while t < 6.8:
    f = hz(pent[rng.integers(len(pent))])
    place(chimes, rng.uniform(.4, 1) * partials(f, 3.5, [1, 2.76, 5.4, 8.93], [1, .5, .25, .1], [2.2, 1.2, .6, .3], attack=0.003), t)
    t += rng.uniform(0.18, 0.7)
breeze = rng.normal(0, 1, len(chimes)); breeze = np.convolve(breeze, np.ones(400) / 400, mode='same')
chimes += 0.05 * breeze / np.max(np.abs(breeze)) * np.sin(np.linspace(0, np.pi, len(chimes)))
finish(chimes, 8.5, 'windchimes', fade_out=2.0)

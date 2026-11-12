"""Moonshine on the cabinet (D260-D262): one long-lived process that loads the model once.

The cabinet service starts it and talks to it over pipes; audio never touches the disk.

    python3 moonshine_helper.py MODEL_DIR ARCH

ARCH is a Moonshine model architecture name, e.g. medium-streaming.

Protocol:
  stdout, at start   {"ready": true, "load_ms": N}  or  {"error": "..."} and exit 1
  stdin, per clip    4-byte little-endian length N, then N bytes of 16 kHz mono signed 16-bit PCM
  stdout, per clip   {"text": "...", "ms": N}  or  {"error": "..."}
A length of 0 is a clip of silence and answers {"text": "", "ms": 0}.
A length of 0xFFFFFFFF (no bytes follow) is "warm up": the helper transcribes its own sample of speech and
answers {"text": "", "ms": N, "warm": true}. The service asks while a kid is still holding the button, so a
helper gone cold while idle is warm again by the time they let go.
"""

import json
import os
import struct
import sys
import time

out = sys.stdout


def say(obj):
    out.write(json.dumps(obj) + "\n")
    out.flush()


def read_exact(stream, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf.extend(chunk)
    return bytes(buf)


WARM = 0xFFFFFFFF


def warm_sample():
    """Two seconds of real speech from the package's own test audio, else silence."""
    try:
        import moonshine_voice
        from moonshine_voice.utils import load_wav_file

        audio, rate = load_wav_file(os.path.join(os.path.dirname(moonshine_voice.__file__), "assets", "beckett.wav"))
        if rate == 16000 and len(audio) >= 32000:
            return audio[:32000]
    except Exception:  # noqa: BLE001 - silence still warms the encoder
        pass
    return [0.0] * 32000


def main():
    if len(sys.argv) != 3:
        say({"error": "usage: moonshine_helper.py MODEL_DIR ARCH"})
        sys.exit(2)
    model_dir, arch_name = sys.argv[1], sys.argv[2]
    t0 = time.monotonic()
    try:
        from moonshine_voice import string_to_model_arch
        from moonshine_voice.transcriber import Transcriber

        transcriber = Transcriber(model_dir, string_to_model_arch(arch_name))
        # Warm it up on speech, so the first kid doesn't wait for the first-call cost.
        sample = warm_sample()
        transcriber.transcribe_without_streaming(sample, 16000)
    except Exception as e:  # noqa: BLE001 - any failure here means no Moonshine
        say({"error": f"couldn't load Moonshine: {type(e).__name__}: {e}"})
        sys.exit(1)
    say({"ready": True, "load_ms": round((time.monotonic() - t0) * 1000)})

    stdin = sys.stdin.buffer
    while True:
        head = read_exact(stdin, 4)
        if head is None:
            return
        (n,) = struct.unpack("<I", head)
        if n == WARM:
            t = time.monotonic()
            try:
                transcriber.transcribe_without_streaming(sample, 16000)
            except Exception:  # noqa: BLE001
                pass
            say({"text": "", "ms": round((time.monotonic() - t) * 1000), "warm": True})
            continue
        pcm = read_exact(stdin, n) if n else b""
        if pcm is None:
            return
        if len(pcm) < 3200:  # under 0.1 s: nothing was said
            say({"text": "", "ms": 0})
            continue
        t = time.monotonic()
        try:
            count = len(pcm) // 2
            samples = [s / 32768.0 for s in struct.unpack(f"<{count}h", pcm[: count * 2])]
            transcript = transcriber.transcribe_without_streaming(samples, 16000)
            text = " ".join(line.text.strip() for line in transcript.lines if line.text.strip())
            say({"text": text, "ms": round((time.monotonic() - t) * 1000)})
        except Exception as e:  # noqa: BLE001
            say({"error": f"{type(e).__name__}: {e}"})
        finally:
            pcm = samples = None


if __name__ == "__main__":
    main()

# Speech on the cabinet

How a kid's voice becomes the words on "Is this right? I heard:" (M6). Decisions: D260–D265 in [decisions.md](decisions.md).

## The path

1. A kid holds a player button on a screen that takes speech (M4/M5, R4). The launcher calls `/api/speech/start`.
2. `arecord` captures 16 kHz mono from the cabinet's first capture device into the service's memory (D262).
3. On release (`/api/speech/stop`), the clip goes to Groq if the cabinet has a key and is online, and to Moonshine on the cabinet otherwise. Moonshine also answers whenever Groq fails, is rate-limited, or takes more than 3 s plus 0.1 s per second of audio (D263).
4. The words go back to the launcher, which shows M6. An empty result shows E9 ("didn't hear that"). The clip is then zeroed and dropped. No audio is ever written anywhere.
5. `speech.jsonl` in the cabinet's logs gets one line per hold. It records the engine, the hold and audio lengths, the latency, the word count, and any engines skipped and why. It never holds the words.

F1 typing is unchanged: it's the keyboard's way to answer.

## Engines

| | Moonshine `medium-streaming` | Groq `whisper-large-v3-turbo` |
|---|---|---|
| Where | On the cabinet, works offline | Groq's API, over the internet |
| When | Always installed. Answers alone without a Groq key | First, once Geoff runs `groq-key.sh` |
| Cost | Nothing | $0.04 per audio hour, billed at a 10 s minimum per request: about $0.0001 per hold |
| Data | Never leaves the cabinet | **Turn on Zero Data Retention first** (below) |

## Turning Groq on

1. In the Groq console, go to **Settings → Data Controls** (console.groq.com/settings/data-controls) and turn on **Zero Data Retention**. Transcription is ZDR-eligible. Without it, Groq may keep requests for up to 30 days for abuse monitoring (Groq docs, checked 2026-11-11).
2. Create an API key in the Groq console.
3. In a Terminal window on the mini, run `scripts/virtual-cabinet/groq-key.sh`. It asks about ZDR, then for the key with no echo, checks the key with Groq, and puts it in the cabinet's `service.json`. The service restarts.
4. For the Picade, once it's connected (`connect-picade.sh`), run `scripts/cabinet-card/groq-picade.sh`. That's groq-key.sh over the Picade's own SSH key (D259). It works with the same key or a new one.

**Rate limit:** on the free tier, Groq answered 429 after about 20 transcriptions in a minute. A kid's holds don't come near that. A 429 is just another failure, so Moonshine answers that hold. The bench takes `--pace 3500` to stay under the limit.

**Fallback, measured on the virtual cabinet** (2026-11-13), using `bench.mjs --engine chain --groq-url`. It runs the service's own chain in a separate process, so the cabinet's network and service were untouched. Moonshine answered every clip in every case:
- Groq unreachable (a blackholed address): Moonshine after Groq's timeout, 6.3 s a hold with the old 6 s timeout. That's why the timeout is now 3 s plus 0.1 s per second of audio.
- Connection refused: Moonshine at once, 211 ms median.
- An error from Groq (404): Moonshine, 388 ms median.
- The real Groq through the same chain: Groq answered all 4, with no words wrong, at 336 ms median.
- Fully offline (no DNS): Groq is skipped without trying (unit-tested).

`groq-key.sh --off` takes the key off, and Moonshine carries on alone.

## The virtual cabinet's mic (D264)

UTM's Apple backend can't pass a USB device through. The VM instead hears **the mini's default input** through virtio sound, which is Geoff's AirPods for now and a USB mic later. Turning it on needs the director's go and Geoff at the mini, because macOS will likely ask him to allow UTM the microphone:

1. Stop the VM and quit UTM (UTM caches the config, D148).
2. Keep a copy of `~/game-studio-data/vm/arcade-virtual.utm/config.plist`, then run `plutil -replace Virtualization.AudioInput -bool true` on it.
3. Run `scripts/virtual-cabinet/up.sh`. If macOS asks, Geoff allows UTM the microphone.
4. Check: `cabinet/vm/drive ssh sudo arecord -l` lists a capture device. With the AirPods connected and chosen as the mini's input, hold a button on M4 and speak.

The Picade needs nothing more: plug a USB mic into the Pi.

## Testing without a mic

- `node cabinet/vm/guest/launcher.mjs hear /path/clip.wav` on the cabinet: the next hold hears that clip in place of the mic, through the same engines. `say` still feeds plain text, as the flows do.
- `scripts/speech/make-clips.sh DIR` makes TTS clips (16 kHz mono WAV with a .txt beside each).
- `node cabinet/service/speech/bench.mjs DIR` measures WER and latency on the cabinet's own Moonshine. On the mini, pass `--speech` a JSON file naming a local venv and model.

## Measurements

| Where | Model | Clips | WER | Latency median / p90 / max |
|---|---|---|---|---|
| Mac mini (M-series), Python 3.12 | medium-streaming | 48 TTS (4 voices) | 23.1% (Samantha 0%, Daniel 5.4%, Flo 22.6%, Junior 64.5%) | 148 / 199 / 306 ms |
| **Virtual cabinet** (4 vCPU), Python 3.13, 2026-11-12 | medium-streaming | same | 23.4% (Samantha 0%, Daniel 4.3%, Flo 22.6%, Junior 66.7%) | 260 / 349 / 450 ms |
| Virtual cabinet, live holds through the launcher (fed clips) | medium-streaming | 3 holds | 1 word wrong in 27 ("ice" heard as "eyes"; Say it again fixed it) | 1874 ms (the first, after 4 min idle), then 541, 488 ms |
| **Virtual cabinet, Groq** `whisper-large-v3-turbo`, 2026-11-13 | (Groq) | same 48, paced 3.5 s apart | **4.3%** (Samantha 0%, Daniel 2.2%, Flo 9.7%, Junior 5.4%) | 239 / 346 / 553 ms |
| Virtual cabinet, Moonshine, same day | medium-streaming | same 48 | 23.4% | 203 / 254 / 299 ms |
| Virtual cabinet, live holds on M4 with Groq keyed (fed clips) | Groq | 2 holds | 0 wrong in 16 | 397, 437 ms |
| Mac mini | small-streaming | same | 30.4% | 93 ms median |
| Mac mini | tiny-streaming | same | 38.7% | 39 ms median |

The first live hold was slow because the helper had gone cold while idle. Since then, the service warms Moonshine when a button goes down after 30 s idle, using two seconds of the package's own speech sample, so the warm-up finishes while the kid is still talking (D262).

Junior is a novelty robot voice and Flo a synthetic one, so the natural voices are the better guide for adults. Kids' voices are the real test: that's the bake-off with Geoff (§3.1). Their clips stay on the cabinet or the mini, are deleted after, and never enter the repo.

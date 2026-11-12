# Speech on the cabinet

How a kid's voice becomes the words on "Is this right? I heard:" (M6). Decisions: D260–D265 in [decisions.md](decisions.md).

## The path

1. A kid holds a player button on a screen that takes speech (M4/M5, R4). The launcher calls `/api/speech/start`.
2. `arecord` captures 16 kHz mono from the cabinet's first capture device into the service's memory (D262).
3. On release (`/api/speech/stop`), the clip goes to Groq if the cabinet has a key and is online, and to Moonshine on the cabinet otherwise. Moonshine also answers whenever Groq fails or takes more than 6 s (D263).
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
4. For the Picade, run the same script with `ARCADE_HOST` set to the Picade's address.

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
| Mac mini | small-streaming | same | 30.4% | 93 ms median |
| Mac mini | tiny-streaming | same | 38.7% | 39 ms median |

Junior is a novelty robot voice and Flo a synthetic one, so the natural voices are the better guide for adults. Kids' voices are the real test: that's the bake-off with Geoff (§3.1). Their clips stay on the cabinet or the mini, are deleted after, and never enter the repo.

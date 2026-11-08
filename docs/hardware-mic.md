# Microphone for the Picade cabinet

Status: **research done; Geoff picks.** No decision recorded yet (D90–D99 reserved for it).
Every price and stock line below was read live on 2026-11-07 from the page cited.

## What the mic has to do

- A kid holds ★ (MAKE) on the deck and talks, then lets go. Push-to-talk, so the mic only records while the button is down: no wake word, no always-on listening.
- The speaker is 30–60 cm from the cabinet, standing or sitting at a bartop. Talking is mostly the opening request and "C: Something else" answers; it's short clips.
- Audio goes to Groq Whisper (primary) or Moonshine on the Pi (offline). Both want 16 kHz mono. Clean, close speech matters more than range.
- Basement: probably some echo off hard walls and floor, plus the cabinet's own speaker. The cabinet can mute its speaker while ★ is held, so the game's sound isn't recorded with the kid's voice.
- Kids aged 10 and 13, unsupervised. Nothing that comes off easily, gets yanked out, or has to be worn.
- Raspberry Pi 5 on Raspberry Pi OS Lite (trixie). It has no mic input, so the mic has to be USB. A USB Audio Class device uses the stock `snd-usb-audio` driver, so no driver install. Check it with `arecord -l` and a test recording.

## The cabinet: where a mic can go

From [pishop.us](https://www.pishop.us/product/picade-with-10-inch-display/) ($349.95, in stock) and Pimoroni's 2025 [assembly guide](https://learn.pimoroni.com/article/assembling-your-picade):

- The cabinet is powder-coated MDF, 310 × 260 × 250 mm (H × W × D), with a **removable back panel (F)**.
- The case has **no external USB ports or panel-mount sockets**, and no mic or audio input. Audio is out only: a mono I2S DAC with a 3 W amp on the Picade X HAT, driving one 3" speaker.
- The Pi 5 mounts on the base panel (A), with its SD slot over a rectangular cutout in the back. The screen's driver board takes power from **one of the Pi's USB-A ports**, which leaves **three USB-A ports free inside the case**.
- The control deck is small: one stick, six player buttons and four utility buttons on a 260 mm wide panel. There's no room for a mic on the deck itself.

So the mic's cable has to get out of the case. There are two ways:

1. **No modification:** route the cable out past the back panel, through the SD cutout or the gap the power cable already uses. Check this when the kit is assembled; I couldn't confirm the gap from the guide.
2. **Tidy:** drill one hole in back panel F and fit a panel-mount USB-A socket, giving the cabinet a USB port on the back. Adafruit's [Panel Mount USB Cable A-M to A-F](https://www.adafruit.com/product/908) costs $3.95 (in stock). It fits walls up to 0.25" thick, uses two M3 screws 30 mm apart, and has 10.2" of cable. Panel F comes off and is cheap MDF, but drilling it is Geoff's call.

## Options

| | A. Gooseneck (recommended) | B. Mini USB plug mic | C. 4-mic array |
|---|---|---|---|
| Product | Audio-Technica **ATR4750-USB** | Adafruit **Mini USB Microphone** (3367) | Seeed **reSpeaker XMOS XVF3800**, with case |
| Price, stock (2026-11-07) | **$39.00**, "Get it by Wednesday, Nov 11" ([audio-technica.com](https://www.audio-technica.com/en-us/atr4750-usb)) | **$5.95**, in stock ([pishop.us](https://www.pishop.us/product/mini-usb-microphone), SKU 1078; same price, in stock, at [adafruit.com](https://www.adafruit.com/product/3367)) | **$59.90** with case, $54.90 bare, "Warehouse Available" ([seeedstudio.com search](https://www.seeedstudio.com/catalogsearch/result/?q=XVF3800)). The bare board's [product page](https://www.seeedstudio.com/ReSpeaker-XVF3800-USB-Mic-Array-p-6488.html) showed $60.99, so re-check at checkout |
| Pickup | Omnidirectional condenser, 50–13,000 Hz, on a bendable neck you aim at the kid's mouth | Omni (by design; the pattern isn't published), 22 × 18 × 7 mm | 4-mic circular array, 360°, "up to 5 m" far-field. On-board beamforming, noise suppression, AGC, de-reverb and AEC |
| Range it suits | Near: 15–30 cm | Wherever the plug ends up, unless it's on an extension | Near or far: kids don't have to lean in |
| Pi 5 / Pi OS | USB-C cable, 1.8 m, with a C→A adapter, 5 V bus power. A-T doesn't name Linux, but it's a standard USB mic, so expect `snd-usb-audio`. Verify with `arecord` | Vendor says "needs no driver" and "works great with a Raspberry Pi" | USB Audio Class 2.0. Seeed's wiki shows it on a Pi with `arecord` and `alsamixer`. The non-XIAO version ships with USB firmware. The control tool (`xvf_host`) has no Pi build, but the defaults don't need it |
| Mounting | Desk stand; a monitor mount is included. Stand it on the bar beside the cabinet, or fix the base to the cabinet top (3M Dual Lock) and bend the neck down toward the player | Plugs straight into a Pi port inside the case, which is too far and muffled. Put it on the end of a USB extension, stuck under the marquee or to the side of the cabinet facing the player | Flat puck. Stick it on top of the cabinet or under the marquee lip, facing the player |
| Kid-proofing | The neck is the weak point: bending is fine, yanking isn't. Strain-relieve the cable at the cabinet | Tiny and cheap: easy to lose, easy to replace | Nothing to bend. Mounted flat, it's the sturdiest |
| Noise and echo | Close and omni, so it hears the kid well over a quiet basement. It also hears the room, so muting the speaker while ★ is held matters | The weakest option. Expect a quiet signal and plan to raise gain in software; this is the bake-off's job to find out | The best in a noisy or echoey room. Its AEC can only cancel sound it plays itself (the speaker is on the HAT), so mute while ★ is held anyway |

### Considered and dropped

- **Headset:** the kids would have to put it on at the cabinet every time, it gets shared and lost, and it's another thing to wear. That's the wrong feel for walk-up use.
- **Handheld USB mic on a cord** (like a karaoke mic): fun, but the kid needs one hand for ★ and one for the mic, and the stick sits idle. The cord also gets yanked and the mic dropped. The obvious pick, Audio-Technica's ATR2100x-USB, is marked **DISCONTINUED** on [audio-technica.com](https://www.audio-technica.com/en-us/atr2100x-usb) (2026-11-07).

## Recommendation

**A, the Audio-Technica ATR4750-USB ($39), with B (the $5.95 Adafruit mini) as a spare and a second voice for the bake-off.**

- Close speech at a bartop is the easy case, and a gooseneck aimed at the player wins it for $39 from a known brand. Push-to-talk means far-field tricks (wake words, beamforming across a room) aren't needed.
- The $5.95 mini is cheap enough to buy alongside A. If the Phase 3 bake-off shows it's good enough, the cabinet can drop the gooseneck. If not, it's a spare.
- Go to **C (XVF3800, ~$60)** only if the bake-off shows basement echo or noise hurting transcripts with A. It's also the pick if Geoff would rather nothing sticks out of the cabinet.
- For mounting, start without modification: stand A beside or on top of the cabinet and route the cable out the back. Fit the $3.95 panel-mount socket only if the cable route is ugly or gets pulled.

## Geoff's decisions

1. **Which mic:** A ($39), A + B ($45), or C (~$60). Recommended: A + B.
2. **Where it lives:** standing on the bar beside the cabinet, or fixed to the cabinet top. That's part looks, part how hard it is to knock over.
3. **Drill the back panel** for a panel-mount USB socket ($3.95), or route the cable through existing gaps.

## Implementation notes, for later (not decisions)

- Mute the HAT speaker while ★ is held, and show a "listening" state on screen.
- Capture at the device's native rate and resample to 16 kHz mono for both STT engines. Pick the device by its ALSA name, not by card number, since USB card numbers can move.
- Never write raw audio to disk (HANDOFF); stream from memory.
- The Picade has one player's controls (see the Picade 10" task), so only one kid makes at a time. One mic is enough.

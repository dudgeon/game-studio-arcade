# Microphone for the Picade cabinet

> **Superseded by D89 (2026-11-08):** Geoff is choosing a USB mic himself. The options below are research, not recommendations.

Status: **research done; Geoff picks.** No decision recorded yet (D90–D99 reserved for it).
Every price and stock line below was read live from the page cited: options A–C on 2026-11-07, the XLR option D on 2026-11-08.

## What the mic has to do

- The mic records only while the Studio is listening: when a kid makes a request, or picks the C "Something else" tile. There's no physical MAKE button (D86). The kid holds a player button to talk and lets go to send, and the mic records only while it's held (D87). There's no wake word and no always-on listening.
- The kid is 30–60 cm from the cabinet, standing or sitting at a bartop. Talking is mostly the opening request and "C: Something else" answers; it's short clips.
- Audio goes to Groq Whisper (primary) or Moonshine on the Pi (offline). Both want 16 kHz mono. Clean, close speech matters more than range.
- Basement: probably some echo off hard walls and floor, plus the cabinet's own speaker. The cabinet can mute its speaker while the Studio is listening, so the game's sound isn't recorded with the kid's voice.
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
| Noise and echo | Close and omni, so it hears the kid well over a quiet basement. It also hears the room, so muting the speaker while the Studio is listening matters | The weakest option. Expect a quiet signal and plan to raise gain in software; this is the bake-off's job to find out | The best in a noisy or echoey room. Its AEC can only cancel sound it plays itself (the speaker is on the HAT), so mute while the Studio is listening anyway. Its VAD would help if Geoff picks voice activity to stop listening (D86) |

### Considered and dropped

- **Headset:** the kids would have to put it on at the cabinet every time, it gets shared and lost, and it's another thing to wear. That's the wrong feel for walk-up use.
- **Handheld USB mic on a cord** (like a karaoke mic): fun, but it takes a hand, and the mic sits loose on a cord between turns. If listening is hold-a-button (D86), the kid needs both hands. The cord also gets yanked and the mic dropped. The obvious pick, Audio-Technica's ATR2100x-USB, is marked **DISCONTINUED** on [audio-technica.com](https://www.audio-technica.com/en-us/atr2100x-usb) (2026-11-07).

## Option D: an XLR jack with an XLR gooseneck (Geoff's idea, 2026-11-08)

This is how podiums and conference tables do it. A gooseneck with a male XLR plug at its foot locks into a female XLR jack in the furniture. Inside, an adapter turns the XLR signal into USB for the Pi. The Pi 5's I2S pins are taken by the X HAT's DAC (D84), so USB is the only way in.

### The parts (live, 2026-11-08)

| Part | Pick | Price, stock | Notes |
|---|---|---|---|
| Gooseneck mic | **Samson CM15P**, 15" | **$109.98**, "Only 1 Left", get it by Nov 11 ([samsontech.com](https://samsontech.com/products/microphones/install-microphones/cm15p/)). Also $109.99, in stock, at [Markertek](https://www.markertek.com/product/sam-cm15p/samson-cm15p-gooseneck-podium-microphone) | Cardioid condenser, 60–16,000 Hz, selectable hi-pass filter, male XLR at the base. **Needs 9–52 V phantom power** (4 mA). Comes with a flange mount and a windscreen. The 20" CM20P is $129.99 |
| Jack in the cabinet | **Neutrik NA3FDM**: female XLR in front, male XLR behind | **$11.03**, in stock ([Markertek](https://www.markertek.com/product/na3fdm/neutrik-na3fdm-d-series-3-pin-xlr-f-to-xlr-m-feedthrough-panel-mount)) | D-series with latch lock. Nothing to solder: the adapter plugs straight onto the male end inside |
| (cheaper jack) | Neutrik NC3FD-L-1, female XLR with solder cups | $3.91, in stock ([Markertek](https://www.markertek.com/product/nc3fd-l-1/neutrik-nc3fd-l-1-3-pin-female-xlr-panel-chassis-mount-connector-latching)) | Needs a soldered pigtail to the adapter |
| XLR → USB with phantom | **Shure MVX2U Gen 2** | **$119.00** (was $139.99), Add to Cart ([Best Buy](https://www.bestbuy.com/product/shure-mvx2u-gen-2-digital-audio-interface-black/J78FTSZ3JH)) | A thumb-sized adapter: XLR in, USB-C out. Retailers list 48 V phantom, up to 60 dB gain and 24-bit/48 kHz (I checked the price live, not the specs). It plugs directly onto the back of the NA3FDM |
| (alternative interface) | Focusrite Scarlett Solo 4th Gen | $169.99, Add to basket ([focusrite.com](https://focusrite.com/products/scarlett-solo)) | Has phantom power, a 57 dB gain range and a physical gain knob. **Bus-powered at 900 mA**, which is a problem on this Pi (see below). It's also 143 × 96 × 47 mm, a lot for this case |
| Gone | Behringer UM2 and UMC22, the usual budget interfaces | "No longer available" at [zZounds](https://www.zzounds.com/item--BEHUM2) (2026-11-08) | |

**Total for D: about $240** (CM15P $109.98 + NA3FDM $11.03 + MVX2U $119.00, plus a USB-C-to-A cable if one isn't in the box). Option A is $39.

**Short goosenecks are expensive.** Conference-style 5–6" goosenecks with an XLR base start at about $420 (Audix MicroPod6, from search listings; not checked live). The 5" Shure MX405 uses a 5-pin connector and needs a separate preamp. Every XLR gooseneck I found is a condenser that needs phantom power. A gooseneck bends, so the 15" CM15P can be curved to put its capsule where a short one would sit.

### Where the jack goes on the 10" Picade

From the [assembly guide](https://learn.pimoroni.com/article/assembling-your-picade): the **front panel (E)** is MDF and sits below the control deck. Two of the four utility buttons already go through holes in it (the other two are in the sides). The **deck** is three layers: MDF, printed card artwork, and clear acrylic on top. The guide doesn't give panel thicknesses, so measure on arrival.

- **Front panel E** (Geoff's suggestion): the jack sits below the deck edge, and the neck has to curve up past the stick and buttons to reach a mouth well above the deck. A 15" neck can make that arc, but it sits right where the kid's hands are. It's also at elbow height, so it gets knocked.
- **The deck itself:** drilling the acrylic layer risks cracking it, and the 260 mm deck is already full. Not recommended.
- **Top panel C, front edge** (my pick for D): the jack sits above the screen, and the neck bends forward and down toward the kid's face. It's out of the way of hands, it's harder to grab, and gravity helps hold its shape.
- **Side panel B or D, near the front:** also out of the way, with the neck curving in toward the player.

**Drilling, on any panel:** a D-series jack needs a **24 mm round hole** ("standardized D sized 24 mm panel cutout", [Markertek](https://www.markertek.com/product/nc3fd-l-1/neutrik-nc3fd-l-1-3-pin-female-xlr-panel-chassis-mount-connector-latching)) and two small screw holes. I didn't get the screw spacing from the datasheet; take it from the part when it arrives. In powder-coated MDF:
- Use a 24 mm Forstner bit from the painted side, into a backing board, so the coating doesn't chip.
- Fix the jack with bolts and nuts, not wood screws, so a yank on the neck pulls against metal, not crumbly MDF.
- The CM15P's included flange spreads the load wider, but Samson's page doesn't say whether it takes the jack, so check it in the box.
- Panels come off (tabs and M3 bolts), so this is bench work.

### Getting the signal into the Pi

- **Path:** the gooseneck plugs into the NA3FDM. The MVX2U plugs onto the back of the NA3FDM inside the case, and a USB-C cable runs from it to one of the three free Pi USB-A ports.
- **Pi OS support:** no seller says "Linux". The MVX2U is sold as driverless on Mac, Windows, iOS and Android, so it is almost certainly a standard USB Audio Class device and should work with the stock `snd-usb-audio` driver. Focusrite's page lists only Windows and macOS for the Solo. **Verify with `arecord -l` and a test recording before drilling.**
- **USB power on this Pi:** Raspberry Pi's docs give the Pi 5 **1.6 A** for all USB ports together on a 5 A supply, but **600 mA on a 3 A supply** ([raspberrypi.com](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html); `usb_max_current_enable=1` in `config.txt` overrides the limit).
  - On the Picade, the screen's driver board already draws from one port, and power comes in through the X HAT, so whether the Pi detects a 5 A supply needs checking.
  - The Solo's 900 mA would go over 600 mA. I didn't check the MVX2U's current draw, but it should be much lower.
  - Buy the 5 A supply either way.
- **Gain:** the adapter sits inside the case, so kids can't change the gain. The MVX2U's gain is set in Shure's MOTIV app. I didn't confirm whether the setting is saved on the device; if it isn't, ALSA's mixer on the Pi sets it.

### D against A: kid-proofing, gain and noise

- **Better:**
  - The mic latches in, so it can't be knocked off the bar or carried off.
  - No USB cable dangles out the back.
  - The gain is out of reach.
  - The cardioid capsule hears less of the room and of the cabinet speaker than A's omni one.
  - Any XLR mic can be swapped in later.
  - It looks like part of the machine.
- **Worse:**
  - About six times the cost.
  - A hole in the cabinet and three more parts.
  - A 15" neck a kid can lever on; the bolts and nuts are what hold.
  - The phantom power, USB power and Linux support all need checking before drilling.
- **Transcripts:** a close condenser should transcribe about the same through A or D. The difference is the build, not the hearing. The Phase 3 bake-off can confirm.

## Recommendation

**If Geoff wants a mic that's part of the cabinet: D, the XLR build, about $240.** That's the Samson CM15P in a Neutrik NA3FDM jack on the **front edge of the top panel**, with a Shure MVX2U inside. It's the most kid-proof option: it latches in, nothing can be carried off, and the gain is out of reach.

**Otherwise: A, the Audio-Technica ATR4750-USB ($39), plus B (the $5.95 Adafruit mini) as a spare and a second voice for the bake-off.** Transcripts will likely be as good as D's; the trade is a mic standing loose on the bar.

- **For D, test before drilling.** Plug the CM15P straight into the MVX2U on the Pi and check `arecord -l`, a 16 kHz recording, the gain and the USB power. Cut the hole only after that works.
- **Put D's jack on the top-front edge, not front panel E.** On E, the neck has to curve up through the kids' hands.
- The mic only listens when the Studio asks, so far-field tricks like wake words and beamforming across a room aren't needed. Go to **C (XVF3800, ~$60)** only if the bake-off shows echo or noise hurting transcripts, or if Geoff picks voice activity for D86, since C has its own VAD.

## Geoff's decisions

1. **Built-in or loose:** D, the XLR mic fixed to the cabinet (about $240), or A, the USB gooseneck on the bar ($39; $45 with B). Recommended: D if a fixed mic matters to him, otherwise A + B.
2. **For D, where the jack goes:** the front edge of the top panel (recommended), front panel E (his idea; the neck crosses the kids' hands), or a side panel. It's one 24 mm hole.
3. **For A, where it lives:** standing on the bar or fixed to the cabinet top. Also whether to drill the back panel for a $3.95 panel-mount USB socket, or route the cable through existing gaps.
4. **What starts and stops listening** is already open as D86. It doesn't change the mic, except that voice activity favours C.

## Implementation notes, for later (not decisions)

- Mute the HAT speaker while the Studio is listening, and show a "listening" state on screen.
- Capture at the device's native rate and resample to 16 kHz mono for both STT engines. Pick the device by its ALSA name, not by card number, since USB card numbers can move.
- Never write raw audio to disk (HANDOFF); stream from memory.
- The Picade has one player's controls (see the Picade 10" task), so only one kid makes at a time. One mic is enough.

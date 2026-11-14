# Studio round two: the plan

2026-11-14. Research and a plan; nothing here is built. It answers Geoff's feedback after the first real makes on the Picade (two new games and one change): speech that gets cut off, transcripts that can't be read in full, versions that are only "v2, v3", motion that looks basic, and AI inside a running game.

Every proposal below is **proposed**, numbered D450 to D469, and goes into `docs/decisions.md` only once Geoff has answered. His decisions are taken in the narrated walkthrough (`docs/round-two-walkthrough/`), one stop each.

## The short version

| Topic | What we found | What I'd do | Size |
| --- | --- | --- | --- |
| 1. Speech cut off | The recorder stops at 30 s without a sign. 2 of today's 6 holds on the Picade hit it and lost 9 s and 53 s. Groq never timed out or fell back. | Raise the limit to 2 minutes, show the time running, and say when it stopped. | Small |
| 2. Long transcripts | The review box cuts at about 75 words with "..."; the full text is behind a stick-right that only the hint line mentions. With "Add more", that reader shows only the last part. | Pages in place, flipped with the stick. Words appear live while the kid talks, from Moonshine on the cabinet. | Medium |
| 3. Version names | The version is a number everywhere. | Claude offers two names on the plan; the maker picks one, says their own, or lets Claude pick. The name replaces v2 on the shelf. | Small to medium |
| 4. Motion and 2.5D | The Pi 5 has 3 to 30 times more room than the games use. The basic look comes from what the library offers Claude, not from the hardware. | A motion kit and three 2.5D modules, all drawn in software so the playtest still works. | Medium to large |
| 5. AI in games | A Haiku call costs about 0.006 cents. The cabinet service can proxy it with the key it already holds. | `g.ai` for lines and choices, with built-in fallbacks, a monthly cap outside the kids' coin pot, and everything logged on the cabinet. | Large |

## How this was researched

- **The Picade's own logs**, read over its admin SSH (D259), read-only: `speech.jsonl` (which never holds words), `publish_gate.jsonl` (frame times), the journal's speech lines, and the kiosk's Chromium flags. No kid's words were read into this document or the repo; only lengths, counts and timings are quoted.
- **A benchmark on the real Pi 5**, with the director's go and nobody playing or making: a headless Chromium on a page under `/tmp`, deleted afterwards. The kiosk, the service and `/var/lib/arcade` weren't touched.
- **The code**: `cabinet/service/src/speech-live.js`, the launcher's talk and review screens, `runtime/`, `studio-kit/context-pack`, the agent's tools, the shelf and the Manager.
- **Current docs**, checked 2026-11-14: Groq's speech-to-text, rate-limit and data pages; Moonshine's docs and the package installed on the Picade; Anthropic's model list and prices.

---

## 1. Speech that isn't cut off

### What the Picade's log shows

Six holds were made on the real cabinet today (2026-11-14, 11:14 to 11:34):

| Held | Audio kept | Lost | Engine | Time to transcribe | Words |
| --- | --- | --- | --- | --- | --- |
| 83.2 s | 30.0 s | 53.2 s | Groq | 2.2 s | 29 |
| 10.7 s | 10.6 s | none | Groq | 0.9 s | 23 |
| 8.6 s | 8.5 s | none | Groq | 1.0 s | 20 |
| 7.9 s | 7.8 s | none | Groq | 0.6 s | 22 |
| 39.3 s | 30.0 s | 9.3 s | Groq | 2.2 s | 72 |
| 14.9 s | 14.8 s | none | Groq | 0.8 s | 45 |

- **The cause is the 30-second recording limit** (`MAX_SECONDS` in `speech-live.js`, D262). After 30 s the recorder keeps running but throws the audio away. The screen still says "Listening... let go when you're done". Two of six holds hit it.
- **Groq is not the cause.** It answered all six, within 0.6 to 2.2 s. Its timeout at 30 s of audio is 6 s. `skipped` is empty on every line: no timeout, no rate limit, no fallback to Moonshine.
- **There is no silence cut-off.** Nothing in the path stops on a pause. The 83 s hold got 29 words into its first 30 s, so the kid was pausing to think, and the recorder kept going as it should.
- **Nothing downstream shortens the words.** The service accepts up to 4,000 characters; typed text is limited to 300 characters, spoken text isn't.
- **Small losses at the edges:** audio is 40 to 130 ms shorter than the hold. Some of that is the recorder starting (it looks up the mic, then starts `arecord`), some is the last buffer when the button is released. It could clip a first or last word that is spoken right at the edge.
- **A log line that looks like an error and isn't:** every hold logs "arecord exited 1: Interrupted system call". That's how `arecord` ends on the stop signal; the audio arrives. It should stop being logged as a failure.
- The cx audit already had this as P2 ("Talking stops being recorded at 30 seconds, with no sign"), from reading the code. The log now shows it happening to a real maker, a third of the time.

### Limits, engine by engine (checked 2026-11-14)

| | Limit | What it means for a longer hold |
| --- | --- | --- |
| Our recorder | 30 s, in memory (D262) | The thing to change. Two minutes of 16 kHz mono is 3.8 MB of memory. |
| Groq `whisper-large-v3-turbo` | 25 MB a file on the free tier; no stated length limit; "optimized for 30-second segments"; 20 requests a minute and 7,200 audio seconds an hour on the free tier | A 2-minute WAV is 3.8 MB. Fine as one request. |
| Groq's timeout (D263) | 3 s + 0.1 s per second of audio | 15 s at two minutes. Groq took 2.2 s for 30 s of audio, so there's room. |
| Moonshine `medium-streaming` | No hard limit; its docs suggest staying under about 30 s per call | For long clips, feed it through its streaming interface, which cuts lines at pauses or at 15 s. Needed anyway for live words (topic 2). |
| The talk screen | No timer, no level, no sign at the limit | The second half of the fix. |

### Options

| | Option | For | Against |
| --- | --- | --- | --- |
| A | Limit 60 s, with a visible timer | Small change | Today's 83 s hold would still be cut |
| **B** | **Limit 2 minutes, a time bar that fills, the last 10 s counted down, and "I stopped listening here" on the review** | Covers every hold so far with room; a kid always knows | A 2-minute idea is long for Claude's first question to restate, though D308 already handles that |
| C | No practical limit (5 minutes as a safety stop) | Never cuts a kid off | A button held by accident records the room for 5 minutes; long clips cost more to transcribe on Moonshine |

### Recommendation

**D450 (proposed). The recording limit goes from 30 s to 2 minutes, and the screen shows it.** A bar fills while the kid talks; the last 10 seconds count down; at the limit the mic turns grey and the screen says "That's as long as I can listen. Let go to see what I heard." The review marks the end: "I stopped listening here."

**D451 (proposed). Don't clip the edges.** Keep the mic's name between holds so the recorder starts sooner, and keep recording for a quarter of a second after the button is released. Stop logging `arecord`'s normal exit as an error.

**D452 (proposed). Say what went wrong, in the kid's terms.** Three cases that look the same today (cx audit C3):
- No microphone: "The microphone isn't plugged in. Ask a grown-up."
- Silence: today's "I didn't hear anything."
- Groq didn't answer and Moonshine did: nothing extra on screen; it's in the log.

**Cost to run:** Groq bills $0.04 an audio hour. A 2-minute hold is 0.13 cents. Nothing else changes.

**Size:** small. One number, the talk screen's bar, three messages, and tests with fed clips of 45 s and 125 s on the virtual cabinet.

---

## 2. Showing long transcripts

### What happens today

- The review ("Is this right? I heard:", M6) shows at most 11 rows of 41 characters, about 75 words, fewer when a question sits above it. Longer text ends in "...".
- The whole text is one stick-right away, in a scrolling reader, but only the hint line says so ("Right: read it all. Up/down: choose."). Geoff and the kids didn't find it.
- **A bug:** after "Add more", the reader shows only the newest part, not the earlier words joined to it (`app.js`, the reader is given `v.transcript` without `v.added`).
- While the kid talks, the screen shows a pulsing mic and no words. A misheard or cut-off idea is only seen afterwards.

### What can stream (docs checked 2026-11-14)

| Engine | Live partial words? | Cost | Notes |
| --- | --- | --- | --- |
| Groq Whisper | **No.** Only whole-file requests. Its docs describe chunking for long files, not live partials. | $0.04/hour, 10 s minimum per request, 20 requests/minute on the free tier | Faking it by re-sending the growing clip every 3 s costs about 2.7 cents for a 2-minute hold and hits the free tier's 20 a minute. |
| **Moonshine on the cabinet** | **Yes.** The package already installed on the Picade has a streaming interface: feed audio as it arrives and it reports each line starting, changing and completing, about twice a second. | Nothing. Works offline. | Less accurate than Groq (WER 23% against 4% on our TTS clips; 6.65% on the public leaderboard). Lines complete at a pause or at 15 s. Published Pi 5 latency: about 0.8 s from the end of a phrase to its text. |
| Deepgram, AssemblyAI, OpenAI realtime | Yes | $0.15 to $1.02 an hour | A third speech vendor and another place for the kids' voices to go. Not worth it. |

So live words are possible with what the cabinet already has: **Moonshine shows the words as they're heard, and Groq still writes the final text** when the button is released. The two can differ by a word or two. The review shows Groq's, since it's the better one.

### Options: reviewing a long transcript

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Pages in place.** The box shows "1 of 3"; stick left and right turn pages; up and down still choose the tile. | Nothing hidden; the stick does what Geoff suggested; the tiles stay on screen | "Yes! That's it" can be pressed without seeing page 3, unless we ask for the last page to be seen first |
| B | Scrolling box. Up and down scroll the words, then move on to the tiles. | One direction for everything | The stick does two jobs; a kid scrolling overshoots into the tiles |
| C | Keep the reader, make it loud. A big "MORE" tile under the words. | Smallest change | Still a second screen; still easy to skip |

### Options: live words while talking

| | Option | For | Against |
| --- | --- | --- | --- |
| A | Timer and a level meter only | Small; shows the mic is alive and when it stopped | A misheard word is still only seen afterwards |
| **B** | **Live words from Moonshine on the cabinet, final text from Groq** | Free and offline; a kid sees it hearing them and sees it stop; Geoff's idea | The live words are rougher than the final ones; needs measuring on the real Pi while recording |
| C | Live words from Groq, re-sent every few seconds | Live words match the final text | About 2.7 cents for a long hold; hits the free tier's limit; words arrive in jumps |

### Recommendation

**D453 (proposed). Long transcripts are read in pages, in place.** A page count on the box ("1 of 3"), stick left and right to turn. It opens on page 1. "Yes! That's it" lights only once the last page has been on screen, so nothing is approved unseen. The same pages serve Claude's long questions and the plan's rules, which use the same box.

**D454 (proposed). Words appear while the kid talks, from Moonshine's streaming interface; Groq writes the final text.** The last three lines of live words sit under the mic, dimmer than final text, so they read as "what I'm hearing" and not as the record. If Moonshine can't keep up on the Pi, the fallback is option A (timer and level) with no other change.

**D455 (proposed). Fix the "Add more" reader** so the whole text is shown. It goes away with D453, but it's a one-line fix worth making first.

**Cost to run:** none. Moonshine is on the cabinet.

**Size:** pages are small to medium (the box, its tests, the three screens that use it). Live words are medium: the Moonshine helper learns a streaming mode, the service passes partial lines to the launcher, and the first step is measuring CPU on the real Pi while `arecord` runs.

**Open question for the build, not for Geoff:** whether the kids' names and game words can be given to Moonshine as key terms (`set_keyterms`, in the installed package) to cut mishearing.

---

## 3. Version names

### Today

- A cart's version is a number. The shelf shows a "v2" tag; the versions list says "Version 2 (newest)"; the result says "Version 2 is ready!"; the Manager shows "v2" beside each play.
- `cart.json` holds `id`, `title`, `players` and nothing else. The spec's Changelog has a line per version.
- A change by another maker starts a new line with its own title (D206), so names matter most for a maker's own v2, v3, v4.

### The design

- **When:** on the change's plan ("What changes", R6), the moment the intent is clear. Claude has just restated the change, so it can name it.
- **Where the name lives:** in the spec first, since the spec is the source of truth. The Changelog heading for the version carries it (`v3 "Faster logs": ...`), and `cart.json` gets `"version_name": "Faster logs"` so the shelf doesn't parse the spec. The cabinet's `cart_version.jsonl` records it with who picked it.
- **Lineage:** the number stays, as the order. The name is a label on it. An unnamed version (every one made so far, and any v1) shows as it does now. A fork's first version takes its title, as today.
- **Rules for a name:** at most 16 characters, plain ASCII (the font), not the same as another version of that game, and through the same screening as any kid's words when spoken (D270).
- **Never delete:** a name isn't changed in place. If renaming is ever wanted, it's a new record in the log, and the Manager is the place for it. Not in this round.

### Screens it touches

| Screen | Today | With names |
| --- | --- | --- |
| R6 "What changes" | Build it! / Change it | After "Build it!", the name question |
| New: the name question | | "What should this version be called?" |
| R7 making | "Making version 3" | "Making Faster logs" |
| R8 result | "Version 3 is ready! Version 2 is still saved." | "Faster logs is ready! Bigger frog is still saved." |
| Shelf (S1) | "v3" tag | "Faster logs" tag |
| Game card and "See other versions" | "Version 3 (newest)" | "Faster logs (newest)", with "v3" small beside it |
| M1/R1 "Who's making?" note | "makes version 4" | unchanged; the name doesn't exist yet |
| Manager: games, plays, activity | "v3" | "Faster logs (v3)" |
| Desktop (`publish_cart`, D343) | no name | an optional `version_name`; the plugin's flow asks for one |

### Options: how the maker picks

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **On the question board the kids already know.** A and B are Claude's two names, C "Something else" opens the mic for their own, D reads "You pick" and Claude chooses. | No new screen to learn or build; their own name is one press away; matches the tiles rule (§3.1) | Two names from Claude, not three |
| B | A new screen with three names and "Say my own" | Three to choose from, as Geoff described | A new board to build and test; a fourth tile for "you pick" makes five |
| C | Name it after it's built, on the result screen | The kid has played it and knows what it is | The make is over, so Claude isn't there: the cabinet would need its own small model call for names, and the spec is already written |

### Recommendation

**D456 (proposed). A version gets a name when its plan is agreed, picked on the question board:** two names from Claude, "Something else" to say one, "You pick" to let Claude choose (option A). If Geoff wants three, option B is about a day more.

**D457 (proposed). The name lives in the spec's Changelog and in `cart.json` as `version_name`, and the number stays as the order.** Unnamed versions show as they do now.

**D458 (proposed). The name replaces "vN" on the shelf, the result, the versions list and the Manager,** with the number kept small where a list needs the order.

**Cost to run:** nothing measurable. It's a few dozen tokens in a make that already runs.

**Size:** small to medium. The agent's brief and `show_plan`'s result, `cart.json`'s schema and its check, five launcher strings, the Manager's three, and the desktop tool. The agent brief changes, so it needs an `ant apply` in each cabinet's workspace (as D274 did).

---

## 4. Smoother motion and 2.5D, with an 8-bit look

### What the Pi 5 can do, measured

The Picade's kiosk is Chromium 156 on Wayland (cage), started with `--use-angle=gles` and GPU rasterization, on a Pi 5 with 8 GB. The house runtime draws every game in software into a 256×192 buffer of palette colours and puts it on a canvas, scaled 4 times by the browser.

**Real games on the Picade** (the publish gate's log, 2,400 frames each): the whole frame, including the page round trip, takes **2 ms at the median and 5 to 7 ms at the 95th percentile**, against 16.7 ms for 60 frames a second.

**The benchmark**, same Pi, same software drawing, one frame of each, including getting it onto the canvas:

| What's drawn each frame | Median | 95th percentile | Share of a 60 Hz frame (p95) |
| --- | --- | --- | --- |
| Nothing (just showing the buffer) | 0.2 ms | 0.3 ms | 2% |
| 200 sprites | 0.1 ms | 0.3 ms | 2% |
| 1,000 sprites | 0.3 ms | 0.6 ms | 4% |
| A textured floor in perspective ("mode 7"), rotating | 0.2 ms | 0.5 ms | 3% |
| A raycast 3D maze, textured walls, floor and ceiling | 0.4 ms | 1.5 ms | 9% |
| 40 sprite-stacked objects, 12 slices each, rotating | 1.7 ms | 4.0 ms | 24% |
| 300 flat-shaded triangles with a depth buffer | 0.7 ms | 1.4 ms | 8% |
| 1,500 triangles | 1.9 ms | 5.6 ms | 34% |

The screen refresh measured a steady 16.7 ms.

**What wasn't measured: WebGL on the real GPU.** A headless Chromium on the Pi gets only software GL (llvmpipe), which is useless as a guide (21 ms for 2,000 triangles). The kiosk's own Chromium almost certainly has WebGL 2 on the Pi's V3D GPU, but proving it needs a page on the cabinet's screen for half a minute. It isn't needed for the recommendation below, so it wasn't done.

### Why the games look basic

It isn't the Pi. It's what Claude is handed:

- The context pack says so itself: "nothing here does 3D or scrolling worlds, so build those from `g` directly and keep them simple."
- The five templates are single-screen: catch, dodge, maze, paddle, blank. There's no scrolling one.
- The library has collisions, grids, scores, timers and turns. It has nothing for movement: no easing, no acceleration, no gravity, no camera that follows, no animation frames, no particles.
- The cart API's example moves a thing with `s.x += 2`. So does every game: a fixed number of pixels per frame, starting and stopping instantly.
- `g.spr` can flip and scale by whole numbers. It can't rotate or scale smoothly.
- The playtest proves rules by reading state, not by looking, so nothing rewards motion that feels good.

### Options

| | Option | What the kids get | Playtest and gate | Size |
| --- | --- | --- | --- | --- |
| **A** | **A motion kit and 2.5D modules, all in software.** Easing, springs, velocity with acceleration and friction, gravity and bounce, a following camera with shake, parallax layers, animation frames, particles, smooth sprite rotation and scaling. Then three ways to get depth: a perspective floor, a raycast maze, sprite stacking. | Movement that speeds up, slows down, bounces and squashes; scrolling worlds; racers on a perspective road; first-person mazes; chunky rotating 3D objects. All in the 32-colour pixel look. | Unchanged. It's still one buffer, the same in Node and in the browser. | Medium to large |
| B | A plus sub-pixel smoothness: sprites placed on the display's 1024×768 grid instead of the 256×192 one | Scrolling and slow movement glide instead of stepping a "big pixel" at a time | The picture on screen is no longer just the buffer, so the headless run can't see what the screen shows without a second path | Large; changes the runtime's core |
| C | A plus real 3D with WebGL | Lit, textured 3D models | The headless playtest can't draw it; the gate needs a real GPU; needs the on-screen measurement first; "8-bit look" has to be forced with shaders | Largest; a second renderer |

### Recommendation

**D459 (proposed). Stay in software, and give Claude a motion kit** (option A's first half): `g.lib.motion` (ease, spring, approach, velocity with acceleration and friction, gravity, bounce), `g.lib.camera` (follow with a soft zone, shake, bounds), `g.lib.parallax`, `g.lib.anim` (frames by time or by distance moved), `g.lib.particles`, and rotation and smooth scale in `g.spr`. Tested like the rest of the library.

**D460 (proposed). Three 2.5D modules, in software:** `g.lib.floor` (a perspective floor and sky), `g.lib.raycast` (a first-person maze from a grid map), `g.lib.stack` (sprite stacking). A fourth, `g.lib.mesh` (a few hundred flat-shaded triangles), only if a game asks for it; the numbers say it fits.

**D461 (proposed). Teach Claude to use them.** In the context pack: a `motion` guide with the house rules ("nothing starts or stops instantly; the camera follows; a hit shakes"), catalog entries, and three new templates: a side-scroller with parallax, a racer on the perspective floor, and a first-person maze. The cart API's example stops moving things with `s.x += 2`. The line "nothing here does 3D or scrolling worlds" goes.

**D462 (proposed). Set the frame-time budget from these numbers** (D311 left the gate uncalibrated): the Picade's games sit at 6 ms at the 95th percentile, so 12 ms is a fair line for "too slow" once Geoff wants the gate to block on it.

Options B and C stay open. B is worth a look after the kit, if scrolling still looks steppy to Geoff. C is worth it only if a kid's idea needs real 3D models.

**Cost to run:** nothing on the cabinet. In a make, the guides and modules are read only when a game needs them (D164's rule), so a plain game costs the same and a 2.5D one reads perhaps 2,000 to 4,000 more tokens, well under a coin.

**Size:** the motion kit is medium (five small modules, sprite rotation, tests, one guide). The 2.5D modules and three templates are medium to large. Order inside the topic: motion kit, the scroller template, then floor, raycast, stack.

---

## 5. AI at runtime in games

Geoff's examples: a duck that tells a new joke each time it crosses the road; a strategy game whose levels or characters feel different each time.

### How it would work

```
game.js ──g.ai──▶ runtime host ──▶ launcher ──▶ cabinet service ──▶ Anthropic (Haiku)
 (no key,          (passes it      (same page)   (the key, the caps,
  no network)       along)                        the safety brief, the log)
```

- **The key never reaches a cart.** A cart runs in a sandboxed frame with no network (D13, D21). It asks the runtime; the launcher passes the ask to the cabinet service; the service calls Anthropic with the cabinet's own key (D131), as it already does for screening (D272).
- **The model:** `claude-haiku-5-5`, $0.10 per million tokens in and $0.50 out (checked 2026-11-14; the same as D272 found on 2026-11-11). Low effort, thinking off, a short answer.

### How a cart asks: `g.ai`

A game can't wait: `update` runs 60 times a second. So `g.ai` never blocks. A cart declares what it wants once, with lines to use when there's no answer, and then asks; it gets the best thing available right now.

```js
init(g) {
  g.ai.lines("joke", {
    ask: "A short, silly duck joke for a kid. One or two sentences.",
    fallback: ["Why did the duck cross the road? To prove he wasn't chicken!", "What time does a duck wake up? At the quack of dawn!", "..."],
  });
  g.ai.choice("mood", { ask: "The boss just lost a round. How does it act next?", options: ["sneaky", "angry", "scared"] });
}
update(g, s) {
  if (s.duckCrossed) s.say = g.ai.next("joke");           // always returns a line, at once
  if (s.roundOver) s.bossMood = g.ai.pick("mood", { round: s.round, score: s.score });   // one of the options, at once
}
```

- **`lines`:** the service asks Haiku for a batch (say 12) in one call and deals them out one at a time. The game never waits, and one call covers a dozen crossings.
- **`choice`:** Haiku picks one of the cart's own options (structured output, so it can't answer anything else). Until the answer arrives, or without one, the cart's seeded random picks.
- **`numbers`** (a later step): level settings within ranges the cart gives, for "each level feels different".
- **What a cart can't do:** send free text typed or spoken by a player. The asks are written at build time and take only numbers and the cart's own listed words. So a player can't steer the model, and no kid's words go to the model from a game.

### Safety (D270 to D276 carried over)

- **A house brief the cart can't change** goes in front of every ask: for kids 8 to 13; kind and silly; cartoon game action is fine; no swearing, slurs, mocking people, scary or grown-up content; no links, names of real people, questions back to the player, or talk about being an AI; plain ASCII; at most 120 characters a line.
- **The asks themselves** come from the kid's idea, which was already screened before the make (D270), and the Studio agent's brief (D274) covers what it writes.
- **Every answer passes the word list** (D271) before a cart sees it. A line that fails is dropped and the next one is used. A refusal from the model is treated the same way.
- **Everything is logged** on the cabinet: `logs/game_ai.jsonl` with the cart and version, the ask, the answer, tokens, cost, time, and whether it was fresh, from the cache, a fallback or over the cap. No approval loop; the log is the oversight (§3.1). The Manager's activity page shows it.
- I wouldn't add a second model call to judge each answer. It doubles the cost and the wait for output that is already short, constrained and logged. It can be added per game later if the log shows a need.

### Offline, speed, and the playtest

- **Offline or over the cap:** `g.ai` returns the cart's fallback lines and seeded-random choices. The game plays the same way, just less varied. Fallbacks are required: the cart check fails a `lines` with fewer than three, so a game can't depend on the network (cabinet independence, §3.1).
- **Speed:** a Haiku call is about a second. Because lines come in batches and are kept, the wait is hidden: the first batch is asked for when the game starts.
- **Kept on the cabinet:** each game keeps its last 50 or so lines per ask, so a later play offline still has fresh-looking ones.
- **The playtest and the publish gate never call the model.** In a headless run `g.ai` uses only fallbacks and the seeded random, so tests stay repeatable and free.

### What it costs

One batch of 12 jokes: about 350 tokens in and 400 out, **0.024 cents**. One choice: about 300 in and 20 out, **0.004 cents**.

| Use | Calls | Cost |
| --- | --- | --- |
| One play of the duck game, 30 crossings | 3 batches | 0.07 cents |
| A strategy game, a choice every round, 40 rounds | 40 | 0.16 cents |
| A heavy month: 300 plays across AI games | about 3,000 | 30 to 50 cents |

The family pot is 100 coins a month at 10 cents a coin ($10). A new game uses about 6 coins. A whole month of AI in games costs less than one make.

### Options: who pays, and the caps

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Outside the coin pot, with a hard cap of $1 a month** for the cabinet, plus 40 calls a play and 300 a day per game. Over a cap, games use their fallbacks. | Playing never costs the kids coins; the worst month is $1; simple to explain | The kids don't see that AI has a cost |
| B | From the coin pot: one coin buys a game a block of 1,000 calls, taken when the last block runs out | AI is visibly not free, which fits the learning goal | Playing a game can take a coin, which breaks "playing is free"; a friend playing spends the maker's coins |
| C | Outside the pot, no monthly cap, only the per-play and per-day limits | Never falls back for money reasons | A runaway game is caught by the daily limit only; worst case a few dollars a month |

### Options: what games may ask for in the first version

| | Option | For | Against |
| --- | --- | --- | --- |
| **A** | **Lines and choices only** | Covers both of Geoff's examples; the safest shape; nothing a player types reaches the model | No generated levels yet |
| B | A plus numbers for levels | "Each level feels different" by design, not just by mood | More to check: a generated level has to be playable |
| C | Open chat with a character | The most magical | A player's own words reach the model; needs the mic in a game; a real safety design of its own |

### Recommendation

**D463 (proposed). Games can ask a Haiku-class model for lines and choices through `g.ai`,** proxied by the cabinet service with the cabinet's key. Fallbacks are required and the game never waits.

**D464 (proposed). It's paid outside the kids' coin pot, capped at $1 a month,** with 40 calls a play and 300 a day per game (option A). The Manager shows the month's use.

**D465 (proposed). A house safety brief, the word list on every answer, and a full log on the cabinet.** No per-answer model check, no approval loop.

**D466 (proposed). The playtest and the gate never call the model;** they run on fallbacks.

**D467 (proposed). The Studio learns it:** a `game-ai` guide in the context pack; a catalog line; an "AI" section in the spec listing each ask, its fallbacks and why it's there; and Claude offers it as a question tile when an idea fits ("Should the duck make up new jokes each time?"), never by default.

**D468 (proposed). First version: lines and choices.** Numbers for levels next. Open chat is not planned.

**Size:** large, in four steps: the service's proxy with caps and the log; `g.ai` in the runtime with fallbacks and the headless behaviour; the context pack and the agent's brief (an `ant apply`); the Manager's view. The virtual cabinet proves it first.

**An Anthropic account note:** the calls go through the cabinet's workspace key under commercial terms, like the makes (§3.1). Nothing new to set up.

---

## Order of work

**D469 (proposed).** By what hurts the kids most today, then by size:

| Step | What | Why here | Rough size |
| --- | --- | --- | --- |
| 1 | Speech limit, timer, "stopped listening", edge clipping, the three messages, the "Add more" fix (D450 to D452, D455) | It's losing kids' words now, and it's small | 1 session |
| 2 | Pages on the review (D453) | The other half of "we can't see what was heard" | 1 session |
| 3 | Version names (D456 to D458) | Small, and they'll want it at the next change | 1 to 2 sessions |
| 4 | Motion kit and the scroller template (D459, D461) | The biggest change to how every new game feels | 2 to 3 sessions |
| 5 | Live words (D454) | Needs a measurement on the Pi first; steps 1 and 2 already remove the harm | 2 sessions |
| 6 | 2.5D modules and their templates (D460) | Builds on the motion kit | 2 to 3 sessions |
| 7 | AI in games (D463 to D468) | The largest, and the only one that adds a running cost | 3 to 4 sessions |

"A session" is one worker's focused run with tests, on the virtual cabinet first. Steps 3, 4 and 7 change the agent's brief, so each ends with an `ant apply` in both cabinets' workspaces. Every step reaches the Picade through the Manager's update (D330).

Steps 1 to 3 can run side by side with step 4: they touch the launcher and the service; step 4 touches the runtime and the context pack.

## What each costs to run

| | Per use | Per month, heavy use |
| --- | --- | --- |
| Longer recordings (Groq) | 0.13 cents for a full 2 minutes | Under 5 cents |
| Live words (Moonshine) | Nothing | Nothing |
| Version names | A few dozen tokens in a make | Nothing measurable |
| Motion and 2.5D | 2,000 to 4,000 more tokens in a make that uses them | Under a coin |
| AI in games | 0.024 cents a batch of lines, 0.004 cents a choice | 30 to 50 cents, capped at $1 |

## Not done, and why

- **WebGL on the Pi's real GPU wasn't measured.** It needs a page on the cabinet's screen. The recommendation doesn't depend on it.
- **Moonshine's speed on the real Pi while recording wasn't measured.** The Picade's log only has Groq answering. It's the first step of D454.
- **Groq's limit on one request's length isn't stated in its docs.** Two minutes is well inside its file-size limit; the fed-clip test in step 1 will show it.
- **The kids' voices weren't part of this.** The accuracy numbers are from TTS clips (docs/speech.md); the bake-off with their voices is still to do.

## Sources

- The Picade's logs, 2026-11-14 (not in the repo).
- Groq: console.groq.com/docs/speech-to-text, /docs/rate-limits, /docs/models, /docs/your-data.
- Moonshine: github.com/moonshine-ai/moonshine `docs/` (transcription, options, models, moonshine-vs-whisper, benchmarks); `moonshine_voice/transcriber.py` as installed on the Picade.
- Anthropic: the current model list and prices (Claude Haiku 5.5, $0.10 / $0.50 per million tokens).
- This repo: `cabinet/service/src/speech-live.js`, `cabinet/service/launcher/{app,screens,text,shelf,boards}.js`, `runtime/src`, `runtime/lib`, `studio-kit/context-pack`, `studio-kit/managed-agent/agents`, `docs/cx-audit.md`, `docs/speech.md`, `docs/decisions.md` (D262, D263, D270 to D276, D311).

## Geoff's decisions (2026-11-14)

From the walkthrough (answers saved on its page) and chat:

- D450: **no recording limit and no silence stop** ("There is no reason for a cutoff in length of transcription"; confirmed over the page's 5-minute pick). A hold records as long as it's held; long audio is chunked, never cut.
- D453: pages, turned with the stick left and right.
- D454: live words from Moonshine, final text from Groq.
- D456: names on the question board: two names, say your own, or "You pick".
- D459: the kit in software, plus sub-pixel glide.
- D464: AI in games is paid outside the coin pot, uncapped, with every call's cost logged (Geoff's own answer).
- D468: lines, choices, and open chat with a character.
- D469: order as planned: speech, pages, names, motion, live words, 2.5D, AI.

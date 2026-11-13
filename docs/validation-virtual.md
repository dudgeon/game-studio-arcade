# End-to-end validation on the virtual cabinet (2026-11-12)

Geoff's goal (docs/validation-direction.md): one complete game generation, start to finish, using only the planned controls or their keyboard equivalents. This is the virtual cabinet's run. The real cabinet's comes after its bring-up.

- **What:** main e4737d5 on the virtual cabinet, updated in place by the director.
- **Who:** maker "Tester", plus "Tester2" for someone else's version.
- **When:** 2026-11-12, 21:46 to 22:20 EST, in one sitting.
- **How:** every key went through `cabinet/vm/drive` and `flow.mjs` (D82 keys through uinput). Typing used F1, and speech was a macOS TTS voice (Samantha) fed through `launcher.mjs hear` into the cabinet's own speech engine (Moonshine, D264).
- **Not used during the run:** direct API calls, file edits on the cabinet, service commands. The voice clips were copied to `/tmp/e2e-clips` on the cabinet as the run's input.
- **Screenshots:** in `~/game-studio-data/vm/verify/e2e-virtual-2026-11-12/`, one folder per step (`01` … `24`). Each shot has the launcher's fit record beside it.

## Result

**Pass, with notes.** The whole loop ran with the planned controls, from the shelf to a voice request, through Claude's questions, a build, play, a change, someone else's version, a downloaded game and the coin history, to the Manager's record of it all. Nothing had to be fixed mid-run. Total cost: **$1.41 of the $3**.

| # | Step | Result | Screenshots |
|---|---|---|---|
| 1 | Shelf; COIN shows the pot; back | Pass | `01/` |
| 2 | Make: coin check, COIN, idea by voice, "Is this right?" | Pass (the voice was misheard a little; see notes) | `02/`, `02b/`, `03/` |
| 2a | The request names Tetris | Pass. Screening passed it (naming a game isn't a guardrail matter), and the Studio made her own game, **Candy Cat Drop**, with no Tetris name or look and no scolding | `06/`, `08/` |
| 3 | Questions: A or B, "Something else" by voice, then Make it now | Pass | `04/`, `05/`, `05b/`, `06/` |
| 4 | The plan shows how to play; Build it; the track and the coin meter | Pass | `06/`, `07/` |
| 5 | Play to game over; you-checks; score and best on the post-game screen; play again | Pass, but the score was 0 both times; see "Is the game fun and correct?" | `08/` to `13/`, `play/` |
| 6 | Change it by voice, through to version 2; play it | Pass. The cat wears a party hat | `14/` to `16/` |
| 7 | Tester2's own version, through R2 | Pass. **Fruit Cat Drop**, by Tester2, indented under Candy Cat Drop | `17/` to `19/` |
| 8 | Play teti by Geoff: score and best | Pass. "Score: 236. Best: 248." after a real game over in Marathon | `20/` to `22/` |
| 9 | COIN: the pot, per-maker totals, the coin history | Pass. Every charge is listed | `23/` |
| 10 | The Manager's Activity: makes with requests, answers, costs, and the screened requests | Pass, with one display oddity | `24/` |

## Each step

1. **Shelf and pot.** Shelf; COIN opened the family pot (84 coins at the start); "See every game it paid for" showed the history; ESC back twice. Then Make, and "Who's making?" listed Tester first, "used 21 this month".
2. **The request, by voice.**
   - The coin check said "A new game uses about 6 coins … The family pot has 84 coins". Pressing A did nothing there; COIN started it.
   - "Tell me your game idea" opened with "Hi! I'm Claude, an AI." Holding A while the clip played went to listening, then "Is this right? I heard:" with the transcript, and stick right showed it all.
   - The transcript: "Can you make tetris buttway cuter? … he gets really happy when 20 when you clear lines … and can oh and play too, but not on my side." "Owen" came through as "oh and", and "but way" as "buttway".
   - Screening passed it (the Manager shows "pass").
3. **Claude's questions (3).**
   - "Two players: how should they play?" → **A**, take turns.
   - "When does the cat get super happy?" Its option A, "After every 20 lines", came from the mishearing. → **C, "Something else", by voice:** "Every time you clear a line he does a happy little dance." It was heard word for word.
   - "How does it get faster?" → **D, Make it now**.
4. **The plan (M9).**
   - It led with the idea, then "How to play: Stick: slide, down = faster, up = drop. A / B: turn the piece.", then four rules, two marked "you check", and "+ 14 more".
   - The full rules are a stick-right away. One rule says the happy dance lasts "90 frames", which is jargon on a kid's screen.
   - Build it! The track went Plan → Build → Test, with the coin meter counting up.
   - The result: **"Candy Cat Drop" by Tester. This game used 11 coins (109c). That's more than usual (about 6). Claude needed extra tries to make every rule work.** (L4)
5. **Playing it.**
   - G0 "How to play" came first; then the title: candy blocks, the cat on a cushion, "1 player / 2 players", and the controls in a line.
   - Game over said "ALL DONE! Score 0, Best 0", with the cat crying.
   - Two you-checks: "Each kind of block looks like a different shiny candy" (Yes), and "The cat's happy face and sad face are easy to tell apart" (Yes; I saw both faces).
   - G4 said **"Nice game! Score: 0. Best: 0."** Play again once: the same.
6. **The change, by voice.** Change this game → R1 (Tester "makes version 2") → R3 coin check (about 2) → COIN → R4 "It's Claude again!" → Tell Claude something else → "Can the cat wear a little party hat?" (heard word for word) → R6: "The cat wears a little party hat, and keeps it on whether he is calm, happy or sad." → Change it! → R8: **"Version 2 is ready!" 2 coins (15c), about usual.** Played it: the cat has a striped party hat. v2's two checks were asked again; that's by design, since answers are per version.
7. **Someone else's version.** Candy Cat Drop's card → Change this game → R1 → Tester2 ("makes Tester2's own") → **R2 "This is Tester's game. Your changes make a new game, just yours. Tester's stays the same."** → R3 → COIN → R4 → typed (F1): "make the candies into little fruit and call it Fruit Cat Drop" → "Is this right?" → R6 showed the old rule struck through and the new one: fruit instead of candy → **R8 "Your own version is ready!" Fruit Cat Drop, "Tester's game stays the same.", 2 coins (17c)**. On the shelf it sits indented under Candy Cat Drop, with NEW (R9).
8. **teti.**
   - The shelf has teti by TitanPlayz100 (the upstream game) and, indented under it, **teti by Geoff** (Geoff's version, which keeps score). Both are "free game".
   - Each showed G0 from its guest.json, then teti's own picker (Marathon, Sprint, 2 Minutes, Zen).
   - Leaving mid-game showed "Nice game! Playing is always free." with no score, because nothing ended.
   - Playing Geoff's to a real game over gave **"Score: 236. Best: 248."**
9. **The pot.**
   - A1: 70 left of 100 ($6.95); used this month, Tester 33 ($3.31) and Tester2 6 ($0.61); new game about 6, change about 2.
   - A2 lists every charge, newest first, including this run's three, the earlier test runs' "stopped" and "restart" entries, and a grown-up's "Manager check" top-up.
10. **The Manager** (`:8335`, read-only, headless Chromium, its key once).
    - Activity: "19 makes, 23 plays". Each make has its maker, kind, time, outcome, cart and version, coins and dollars, the request in quotes, every question with both options and the answer (a C answer's words in full), how it ended, how often it's been played, and "archived (D301)".
    - "Screened requests" lists every screened request and C answer with "pass".

## Costs (from the cabinet's ledger)

| Make | Session | Ledger | Pot (cents) |
|---|---|---|---|
| New game: Candy Cat Drop, by Tester | `sesn_01Wmo2jewoAgXbJFyszisxWD` | charge 109c, "on the shelf" | 836 → 727 |
| Change: Candy Cat Drop v2 (party hat), by Tester | `sesn_01FarhZi233yXGTjRxW1WrAe` | charge 15c, "on the shelf" | 727 → 712 |
| Own version: Fruit Cat Drop, by Tester2 | `sesn_01VYB282mtBMYgM3VGuAmEXb` | charge 17c, "on the shelf" | 712 → 695 |
| **Total** | | **141c** | |

All three were archived at Anthropic after they finished (D301; each has its "the make finished; archived" correction, ok).

## Is the game fun and correct to play?

- **What's right:** it's her game, recognisably.
  - Candy blocks in seven colours with a shine.
  - A cat on a cushion who is calm, cries when the stack gets high, and grins with sparkles on the title.
  - A next-piece box, levels, score and best, and a title screen that says how to play.
  - It turned "can Owen play too" into a 1-or-2-players choice that takes turns.
  - The controls on the title match what the game does: left/right move, A/B turn, up hard-drops, down speeds up.
  - It looks like a polished small game, not a test.
- **What I couldn't judge, honestly:**
  - I didn't clear a single line, so I never saw a line go POP with sparkles or the cat's happy dance, and every score was 0.
  - The reason is me, not the game. Each look-then-decide turn of mine takes 20 to 30 seconds. A piece falls to the stack in about 10, so it lands before I've decided. Scripted placements (left wall, right wall, centre, with turns) stack without clearing.
  - Whether it's fun to play needs a person at the controls. That's for Alina, or Geoff, on the cabinet.
- **One thing that looked wrong:** a single short tap of left often didn't move the piece. A second tap, or holding, did. Right taps worked.
  - It may be the game's left-repeat handling or the timing of a tap through uinput. Other games took the same taps fine, so it's more likely the game.
  - It's worth a person checking. A you-check can't catch it, because it isn't one of the game's rules.

## Surprises and notes (nothing fixed mid-run)

1. **The voice was misheard, and it carried into the game.** "happy when 20 when you clear lines" became a question offering "after every 20 lines". "can Owen play too" came through as "can oh and play too", though Claude still asked about two players. The C answer fixed the 20-lines error. The kids will need "Say it again" more than the planned run expects.
2. **The new game cost 109c**, about twice the usual 6 coins: Claude needed extra tries. That's the first make over 1.5 times its usual (L4) on this cabinet. The pot would cover about six of them a month.
3. **"90 frames" on the plan screen.** The brief asks for plain words; a rule's number in frames slipped through.
4. **The coin history shows "-0 coins (1c), stopped"** for a 1c stop (from an earlier test run). Less than a coin should read better than "-0".
5. **The cabinet's clock is UTC**, so the coin history's dates and the 1st-of-the-month refill follow UTC, not the family's time zone. Tonight's makes are dated "Nov 13". The cabinet's time zone should be set to the family's.
6. **The Manager lists a restart-collected make twice** (from earlier testing): once for the cut-off record ("Ended by ?") and once for the collected one. It should join them by session id.
7. **A wrapped tile choice:** on the post-game screen, "down" from the bottom tile wraps to "Play again", which once restarted a game I meant to leave. That's how all the menus behave (D182). Fine for a kid, but a tired thumb could find it.
8. **teti's post-game shows no score when you leave mid-game.** That's correct, because nothing was reported, but a kid might expect one.

## What this run did not cover

- A live voice through a mic. The clips were TTS, fed through `hear`; the AirPods or USB mic path (D264) isn't proven here.
- The 10-minute walk-away (proven separately, live, on 2026-11-11, D300 and D302), a stop, and a service restart mid-build (also D302).
- A spend-limit refusal (L5). Its error wording is still a guess.
- Request screening redirecting something (E10). Everything here passed.
- No Wi-Fi (E1, E2), the pot running low or empty (L1, L2), and an overrun (L3). These are driven on the replay only.
- Two players taking turns. The game offers it, but it wasn't played.
- A real person judging the fun, and seeing a line clear, the sparkles and the happy dance.
- The real cabinet (the Picade). Its run follows its bring-up.

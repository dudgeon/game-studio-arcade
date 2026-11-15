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
   - The transcript: "Can you make tetris buttway cuter? … he gets really happy when 20 when you clear lines … and can [a name] play too, but not on my side." The second kid's name was misheard as two short words.
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
  - It turned "can Milo play too" into a 1-or-2-players choice that takes turns.
  - The controls on the title match what the game does: left/right move, A/B turn, up hard-drops, down speeds up.
  - It looks like a polished small game, not a test.
- **What I couldn't judge, honestly:**
  - I didn't clear a single line, so I never saw a line go POP with sparkles or the cat's happy dance, and every score was 0.
  - The reason is me, not the game. Each look-then-decide turn of mine takes 20 to 30 seconds. A piece falls to the stack in about 10, so it lands before I've decided. Scripted placements (left wall, right wall, centre, with turns) stack without clearing.
  - Whether it's fun to play needs a person at the controls. That's for Ivy, or Geoff, on the cabinet.
- **Correction (D303): the left-tap fault isn't real.** I first noted that a single short left tap often didn't move the piece. Measured afterwards, every tap lands: locally with real key events (72 of 72) and on the cabinet through `drive` (each tap one cell, already moved 150 ms later). The one probe that looked wrong was most likely a screenshot taken before the screen caught up.
- **Played properly afterwards (D307):** a falling-blocks bot playing with button presses only cleared 58 lines in 150 pieces, reaching level 12 with a score of 37,700.
  - Every clear made a POP and sparkles, and the cat danced.
  - The cat is sad when the stack passes 12 rows.
  - The score follows the spec exactly (100, 300, 500, 800, times the level).
  - At game over it reported its score.
  - So the game is correct to its spec; whether it's fun still needs a person.

## Surprises and notes (nothing fixed mid-run)

1. **The voice was misheard, and it carried into the game.** "happy when 20 when you clear lines" became a question offering "after every 20 lines". "can [the other kid] play too" came through with the name misheard. The C answer fixed the 20-lines error. The kids will need "Say it again" more than the planned run expects.
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

## After the fixes (2026-11-12, 22:58 to 23:05 EST)

A short live check of D304-D308 on the virtual cabinet. The director had updated it in place to main a4da1b9 and reapplied the agent with the D308 brief. Maker Tester, planned controls only (`flow.mjs` and `drive`), and one new game from a spoken clip containing a name and a number, fed through `hear` as before. Screenshots are in `after-fixes/` beside the run's, one folder per step.

**Result: pass. Cost: 25c (3 coins), from the ledger** (`sesn_01N1HZAs2DehqXJvxUXkpjbM`, charge 25c, "on the shelf", pot 695 → 670c).

| # | Check | Result | Screenshots |
|---|---|---|---|
| 1 | **Claude says the idea back first (D308).** Spoken: "a puppy named Pepper … you win when you catch 15 bones … watch out for the rocks", heard word for word. Claude's first question: **"A puppy named Pepper catches falling bones. Catch 15 to win, dodge rocks?"**, A "Yes, that's it", B "Something else" | Pass | `03/`, `04/` |
| 1a | **A spoken correction, taken before anything else.** C by voice: "Almost. You win when you catch 30 bones, not 15." (heard word for word). Claude's next question moved on to the rocks ("What happens when Pepper gets hit by a rock?"), and the plan says "catch 30 to win" and "Catch 30 bones and you win!" | Pass | `05/`, `05b/`, `06/` |
| 2 | **The plan in plain words (D304).** The summary, how to play and all 13 rules (read in full with stick right): times in seconds ("about every 2/3 of a second"), no frames, milliseconds or code words | Pass | `06/`, `07/` |
| 3 | **The coin history (D248, D305).** The new make is at the top as **"Nov 12 Tester: a new game, Pepper's Bone Catch, -3 coins (25c), on the shelf"**: the local day, though the ledger's time is 04:03 UTC on Nov 13. The earlier run's makes, shown as "Nov 13" then, now read Nov 12. The 1c stop reads **"less than 1 coin (1c), stopped"** | Pass | `09/`, `10/` |
| 4 | **Menus stop at their ends (D306).** Up at the top of the shelf and of "Who's making?", down past the bottom of "Who's making?", of the question tiles (on D) and of the result screen: the highlight stayed put every time, checked with `expect-sel` | Pass | `01/`, `02/`, `06/`, `09/` |

The build itself: "Making your game" took about 4 minutes, and "Pepper's Bone Catch" by Tester came back as "This game used 3 coins (25c). That's about usual."

**Notes**
1. **Two tiles both read "Something else".** D308's B tile, "Something else", sits right above C, the cabinet's own "Something else" (the mic). They look the same, but B sends no words, so Claude has to ask again. B would be clearer as "Not quite".
2. **"Who's making?" lists the latest maker first.** Tester2 was at the top, and the first pass picked Tester2 by mistake. It was backed out at "Tell me your game idea" with ESC, before anything was sent or spent (`01/`), and Tester was picked (`02/`). That's by design, but the highlight starting on someone else is worth knowing.

## The publish gate on the cabinet (2026-11-13, 00:27 to 00:43 EST)

A live proof of D310-D313 on the virtual cabinet, updated in place to main c6f3516 by the director. Maker Tester, planned controls only (`flow.mjs`, `drive`, typing with F1). Screenshots are in `~/game-studio-data/vm/verify/gate-2026-11-13/`.

**Result: pass. Cost: 35c (4 coins), from the ledger** (`sesn_01HomvHVi4GM3LyWYPMzc4PU`, charge 35c, "on the shelf", pot 670 → 635c).

| # | Check | Result | Where |
|---|---|---|---|
| 1 | **Guests after their smoke checks.** At the service's start, teti passed in 5.7 s and teti by Geoff in 5.5 s. Both are on the shelf, with every made game: `/api/carts` still lists all 16. | Pass | `01-shelf/`, `publish_gate.jsonl` |
| 2 | **The replay boards on the new code** (`replay-boards.sh`, its own service on 8341, `/tmp` data). All 11 flows passed. Inside them the gate passed Penguin Catch (12.1 to 12.5 s) and Log Hopper (6.7 s), and twice stopped a guest's check when a flow started a game, running it again after. Nothing was written under `/var/lib/arcade`. | Pass | `02-replay-boards/` |
| 3 | **A live make, gated while a game was being played.** "a frog that catches flies, catch 10 to win", typed. The restate question got A; on the next question, D, Make it now; then the plan and Build it. During Claude's own test the kid pressed ESC and started teti by Geoff. The make came home while teti was being played: the gate waited, and no gate process ran. Leaving teti started it. | Pass | `03-live/` |

**The make, built to ready.**
- The session ended at 00:40:49.
- The Test step's line went "Playing your game to test it", "Checking your game", "Bringing your game home", then **"Checking your game here at home"**.
- The gate's record: **"Fly Catcher passed in 4.7 s on virtual (browser), after waiting 10 s for a game to end"**. Frame time p95 was 1.4 ms (budget 5.57 ms, advisory, D311).
- The result was ready at 00:41:15: 26 s after the session ended, 10 of them waiting for teti.
- Back on the shelf: "New game ready! by Tester - Fly Catcher", and Fly Catcher marked NEW. M11 said "This game used 4 coins (35c). That's about usual."
- The record is in `studio_session` (`playtest.local.gate`: ok, host virtual, driver browser, seconds 4.7, waited_s 10, restarts 0) and in `publish_gate.jsonl`.
- The Manager's Activity shows "cabinet re-test passed in 4.7 s (virtual, after 10 s waiting for a game to end)". The Manager on :8335 was started from an older worktree before the merge, so this view came from a second, read-only Manager on main's code, on :8336, stopped afterwards (`21-manager-activity-make.png`).

**Notes**
1. The service's startup line listed guests as "none" while their first check ran. It now names them, with "(checking)".
2. The kid left teti only about 8 s after the build came home, so the wait was 10 s. A longer play waits longer; the gate starts within about a second of the play ending.

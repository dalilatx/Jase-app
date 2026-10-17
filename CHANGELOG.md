# Changelog

Written for Jase's mom, in plain language. Newest changes first.

## Big update — AI teacher removed, replaced with a free Daily Lesson

### What changed and why

The app used to have an "AI teacher" (Ms. Bright) that wrote lessons, stories,
and word problems on the fly by calling an outside AI service. That meant
every one of those screens could be slow, could break if the AI service was
down or out of credit, and could cost money to run. You asked for the whole
app to be free to run and to never depend on any AI — so it's gone, completely,
along with everything that only existed to support it.

### Removed

- The AI teacher ("Ms. Bright"), the whole "School Day" classroom feature
  (Period 1-5, video lessons, the AI chat), and the Supabase function that
  powered it. Nothing in the app calls any AI, and nothing costs money to run.
- "Make Me a New Story" and "Make Me a New Problem" — these asked the AI to
  write a brand-new story or word problem every time. The built-in libraries
  of real, hand-written stories and word problems are still there and work
  exactly as before.
- The AI "tips" that explained spelling mistakes in Learn mode and Upper
  Grades practice, and the AI pattern-finder in Smart Practice — all replaced
  with instant, free logic that looks at the actual words your kid got wrong
  and finds the real shared spelling pattern (like "ay" or "igh"), the same
  way a person would, just computed directly instead of guessed by an AI.
- Upper Grades (the older-kid math/English/science/social studies section)
  used to let the AI write a lesson for any grade through 12th. Since there
  was never real, hand-written content above 5th grade — only AI-written
  content with no free fallback — Upper Grades now offers 4th and 5th grade,
  where the lessons are solid, hand-written, and were always there. A
  placement test result above 5th grade still lands your kid on real,
  useful 5th-grade lessons instead of a dead end.
- About 1,000 lines of now-unused code and an unused file came out with all
  of this. The app is smaller and simpler than it was.

### Added: Daily Lesson (free, replaces "School Day")

- Every day, each child gets a fresh Reading lesson and a fresh Math lesson,
  picked automatically from the app's own built-in word lists, phonics
  stories, math facts, and word problems — the same real content that was
  already in the app.
- The words and facts picked each day favor whatever your child hasn't
  mastered yet, so practice stays targeted. Once everything in a grade is
  mastered, it cycles through for review instead of getting stuck.
- Stories and word problems rotate day to day so it doesn't repeat the same
  one every time.
- Finishing Reading or Math assigns one simple, screen-free homework activity
  (built from a small library of hands-on activities — word hunts, flashcards,
  drawing the math, etc.) using today's actual word or fact, so it's never
  generic. Doing the same subject again the same day won't pile up a second
  assignment.
- A homework item still walks your kid through steps, asks how it went,
  lets them write a quick note, and gives them a sticker — same as before,
  just with a free, instant congratulations message instead of an AI reply.
- Everything here saves the same way the rest of the app always has.

### Progress report (for you)

- "This Week's Note" and the "Pattern Report" used to be written by the AI,
  which meant they could fail to load or occasionally say something not
  quite true. They're now built instantly from your child's real saved
  data — real words mastered, the real grades they came from, the real
  test score, the real streak, and the real shared spelling pattern in
  their recent mistakes. There's no more "Generate" or "Refresh" button to
  wait on, because there's nothing to generate — it's just always accurate
  and always there.
- Printing or saving the summary for a teacher works exactly as before.

### Checked everywhere else

- Went through every screen and button in Reading, Math, Upper Grades, the
  Game Arcade, Avatar Shop, Backup & Restore, and the Placement Test and
  confirmed each one still opens and works correctly after all of the above.
- Confirmed, directly against the exact shape of data already saved on this
  app, that nothing already saved was lost or changed by this update:
  mastered words and facts, test scores, streaks, badges, coins, placement
  results, and analytics all still load exactly as they did before.
- An old, no-longer-used leftover from the removed School Day feature (if a
  family happened to have one saved) is left alone rather than deleted —
  nothing touches data nothing reads anymore, just in case.

### Everything else you asked for

- **Big, easy buttons on phone and Chromebook:** checked — every button in
  the app already uses the same large, rounded, high-contrast style sized
  for small fingers on a touchscreen, and that didn't change.
- **Read-aloud for younger kids:** checked — words, math facts, and
  questions already speak out loud automatically using the browser's free
  built-in voice (no app ever needed an internet AI voice), and that's true
  everywhere, not just for younger grades.
- **Fun feedback — sounds, animations, stars/rewards, streaks:** checked —
  the chime sounds, pop animations, coins, avatar shop, stickers, badges,
  and daily streak counter were already there and all still work.
- **Progress always saves:** checked — see "Checked everywhere else" above.
- **Loads fast and feels smooth:** removing the AI teacher and everything
  that depended on it also removed about 1,000 lines of code the app no
  longer needs, so there's less for the browser to load, not more.

Everything above has been tested. The only thing left is walking you through
putting this update on the live site, one small step at a time.

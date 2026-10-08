// Game Arcade: five game styles that can play ANY question set in the app.
//
// Every game takes the same input — a list of multiple-choice questions:
//   { q: "8 + 5 = ?", choices: ["12", "13", "14"], answer: 1, say?: "8 plus 5" }
// (`say` is read aloud instead of `q`, e.g. for "tap the word you hear").
// So sight words, math facts, upper-grade cards and every School Day lesson
// all work in every game, and a new game works for every subject at once.
//
// Games get helpers from the app through props: speak(text), chime(correct),
// onAnswer(correct) for progress tracking, and onFinish({ correct, total, won }).

import React, { useState, useEffect, useRef, useCallback } from "react";

export const ARCADE_GAMES = [
  { id: "tower", title: "Tower Defense", emoji: "🏰", color: "#4F8A6B", blurb: "Answer to earn coins, build towers, stop the monster waves" },
  { id: "maze", title: "Maze Chase", emoji: "👻", color: "#8E7CC3", blurb: "Run to the right answer — don't let the ghosts catch you" },
  { id: "racing", title: "Racing", emoji: "🏎️", color: "#D98551", blurb: "Every right answer speeds up your car" },
  { id: "whack", title: "Whack-a-Mole", emoji: "🔨", color: "#B5643A", blurb: "Bop only the moles with the right answer" },
  { id: "gameshow", title: "Game Show", emoji: "🎤", color: "#3D6E96", blurb: "Beat the clock, build a streak, use lifelines" },
];

const INK = "#2B2250";
const MUTED = "#8B8499";
const LINE = "#EEE6D6";
const LETTERS = ["A", "B", "C", "D"];

// Test hook: lets automated tests run timed games faster. 1 = normal speed.
function gameSpeed() {
  return (typeof window !== "undefined" && window.__arcadeSpeed) || 1;
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deals questions in shuffled order, reshuffling when the deck runs out.
function useDeck(questions) {
  const deck = useRef([]);
  return useCallback(() => {
    if (deck.current.length === 0) deck.current = shuffled(questions);
    return deck.current.shift();
  }, [questions]);
}

// Reads a new question aloud when it has spoken text (or early readers need it).
function useReadAloud(question, speak, always) {
  useEffect(() => {
    if (!question || !speak) return;
    if (question.say) speak(question.say);
    else if (always) speak(question.q);
  }, [question]); // eslint-disable-line
}

function Frame({ title, color, onExit, stats, children }) {
  return (
    <div className="max-w-md mx-auto pb-8">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `2px solid ${LINE}` }}>
        <button onClick={onExit} className="kbtn font-bold text-sm px-3 py-2 rounded-full" style={{ color: INK, background: LINE }}>← Games</button>
        <div className="font-black text-base" style={{ color }}>{title}</div>
        <div className="text-xs font-black text-right" style={{ color: INK, minWidth: 64 }}>{stats}</div>
      </div>
      <div className="px-4 pt-3">{children}</div>
    </div>
  );
}

function QuestionCard({ question, color, speak, compact }) {
  return (
    <div className={`rounded-2xl ${compact ? "p-3" : "p-4"} mb-2 flex items-start gap-2`} style={{ background: "#fff", border: `2px solid ${color}` }}>
      <div className={`font-black flex-1 ${compact ? "text-sm" : "text-base"}`} style={{ color: INK }} data-question>{question.q}</div>
      {speak && (
        <button onClick={() => speak(question.say || question.q)} aria-label="Read aloud" className="kbtn w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm" style={{ background: `${color}22` }}>🔊</button>
      )}
    </div>
  );
}

// 2-column answer buttons; `feedback` = { picked, answer } to colour them after a tap.
function Choices({ question, onPick, feedback, hidden, labels }) {
  return (
    <div className={`grid ${question.choices.length > 2 ? "grid-cols-2" : "grid-cols-1"} gap-2`}>
      {question.choices.map((c, i) => {
        if (hidden && hidden.includes(i)) return <div key={i} />;
        let bg = "#fff", border = LINE;
        if (feedback) {
          if (i === feedback.answer) { bg = "#6FAE8B22"; border = "#6FAE8B"; }
          else if (i === feedback.picked) { bg = "#D9432F18"; border = "#D9432F"; }
        }
        return (
          <button key={i} onClick={() => onPick(i)} disabled={!!feedback} className="kbtn text-left px-3 py-2.5 rounded-xl font-bold text-sm"
            style={{ background: bg, border: `2px solid ${border}`, color: INK, minHeight: 48 }}>
            {labels && <b className="mr-1.5" style={{ color: MUTED }}>{LETTERS[i]}</b>}{c}
          </button>
        );
      })}
    </div>
  );
}

export function GameOver({ game, correct, total, won, headline, coins, onReplay, onExit }) {
  return (
    <div className="max-w-md mx-auto px-5 pt-10 pb-10 text-center">
      <div className="text-6xl mb-3">{won ? "🏆" : game.emoji}</div>
      <h2 className="text-2xl font-black mb-1" style={{ color: INK }}>{headline}</h2>
      <p className="text-sm mb-4" style={{ color: MUTED }}>{correct} right answer{correct === 1 ? "" : "s"}{total ? ` out of ${total}` : ""}</p>
      {coins > 0 && <div className="inline-block text-lg font-black px-4 py-2 rounded-full mb-6" style={{ background: "#E8B84B22", color: "#8B6F1D" }}>+{coins} 🪙 coins</div>}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onExit} className="kbtn py-3 rounded-xl font-black" style={{ background: LINE, color: INK }}>More Games</button>
        <button onClick={onReplay} className="kbtn py-3 rounded-xl font-black text-white" style={{ background: game.color }}>Play Again</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Game Show
// Kahoot / Wordwall style: a clock per question, points for speed and
// streaks, and three one-time lifelines.
function GameShow({ questions, color, speak, chime, onAnswer, onFinish, onExit, calm }) {
  const ROUNDS = Math.min(10, questions.length);
  const SECONDS = calm ? 30 : 20;
  const [round, setRound] = useState(0);
  const [deck] = useState(() => shuffled(questions).slice(0, ROUNDS));
  const [timeLeft, setTimeLeft] = useState(SECONDS);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [hidden, setHidden] = useState([]);
  const [lifelines, setLifelines] = useState({ fifty: true, time: true, skip: true });
  const question = deck[round];
  useReadAloud(question, speak);

  useEffect(() => {
    if (feedback || !question) return;
    const id = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000 / gameSpeed());
    return () => clearInterval(id);
  }, [round, feedback]); // eslint-disable-line

  useEffect(() => { if (timeLeft === 0 && !feedback && question) pick(-1); }, [timeLeft]); // eslint-disable-line

  function pick(i) {
    const right = i === question.answer;
    chime(right);
    onAnswer(right);
    setFeedback({ picked: i, answer: question.answer });
    if (right) {
      const mult = Math.min(3, 1 + streak * 0.5);
      setScore((s) => s + Math.round((100 + timeLeft * 10) * mult));
      setStreak((s) => s + 1);
      setCorrect((c) => c + 1);
    } else {
      setStreak(0);
    }
    setTimeout(next, 1300 / gameSpeed());
  }
  function next() {
    setFeedback(null);
    setHidden([]);
    setTimeLeft(SECONDS);
    setRound((r) => r + 1);
  }
  function useFifty() {
    const wrong = question.choices.map((_, i) => i).filter((i) => i !== question.answer);
    setHidden(shuffled(wrong).slice(0, Math.max(1, wrong.length - 1)));
    setLifelines((l) => ({ ...l, fifty: false }));
  }

  useEffect(() => { if (round >= ROUNDS) onFinish({ correct, total: ROUNDS, won: correct >= Math.ceil(ROUNDS * 0.7), headline: `${score.toLocaleString()} points!` }); }, [round]); // eslint-disable-line
  if (!question) return null;

  return (
    <Frame title="Game Show" color={color} onExit={onExit} stats={<>⭐ {score.toLocaleString()}</>}>
      <div className="flex items-center justify-between text-xs font-black mb-1.5" style={{ color: MUTED }}>
        <span>Question {round + 1} of {ROUNDS}</span>
        <span>{streak >= 2 ? `🔥 ${streak} in a row!` : ""}</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden mb-3" style={{ background: LINE }}>
        <div className="h-full rounded-full" style={{ width: `${(timeLeft / SECONDS) * 100}%`, background: timeLeft <= 5 ? "#D9432F" : color, transition: "width 1s linear" }} />
      </div>
      <QuestionCard question={question} color={color} speak={speak} />
      <Choices question={question} onPick={pick} feedback={feedback} hidden={hidden} />
      <div className="grid grid-cols-3 gap-2 mt-4">
        <button disabled={!lifelines.fifty || !!feedback} onClick={useFifty} className="kbtn py-2 rounded-xl font-black text-xs" style={{ background: LINE, color: INK, opacity: lifelines.fifty ? 1 : 0.35 }}>✂️ 50/50</button>
        <button disabled={!lifelines.time || !!feedback} onClick={() => { setTimeLeft((t) => t + 15); setLifelines((l) => ({ ...l, time: false })); }} className="kbtn py-2 rounded-xl font-black text-xs" style={{ background: LINE, color: INK, opacity: lifelines.time ? 1 : 0.35 }}>⏱️ +15 sec</button>
        <button disabled={!lifelines.skip || !!feedback} onClick={() => { setLifelines((l) => ({ ...l, skip: false })); next(); }} className="kbtn py-2 rounded-xl font-black text-xs" style={{ background: LINE, color: INK, opacity: lifelines.skip ? 1 : 0.35 }}>⏭️ Skip</button>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- Whack-a-Mole
function WhackAMole({ questions, color, speak, chime, onAnswer, onFinish, onExit, calm }) {
  const ROUND = calm ? 75 : 60;
  const STAY = calm ? 2600 : 1800;
  const draw = useDeck(questions);
  const [question, setQuestion] = useState(() => draw());
  const [moles, setMoles] = useState(Array(9).fill(null)); // { choice, id, bonked }
  const [timeLeft, setTimeLeft] = useState(ROUND);
  const [correct, setCorrect] = useState(0);
  const [misses, setMisses] = useState(0);
  const [flash, setFlash] = useState(null);
  const questionRef = useRef(question);
  const idRef = useRef(0);
  useReadAloud(question, speak);
  useEffect(() => { questionRef.current = question; }, [question]);

  useEffect(() => {
    const speed = gameSpeed();
    const timer = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000 / speed);
    const spawner = setInterval(() => {
      setMoles((holes) => {
        const empty = holes.map((m, i) => (m ? null : i)).filter((i) => i !== null);
        if (!empty.length) return holes;
        const q = questionRef.current;
        const showsAnswer = holes.some((m) => m && !m.bonked && m.choice === q.answer);
        const choice = !showsAnswer && Math.random() < 0.55 ? q.answer : Math.floor(Math.random() * q.choices.length);
        const hole = empty[Math.floor(Math.random() * empty.length)];
        const id = ++idRef.current;
        setTimeout(() => setMoles((hs) => hs.map((m) => (m && m.id === id ? null : m))), STAY / speed);
        const next = [...holes];
        next[hole] = { choice, id, qKey: q.q };
        return next;
      });
    }, 650 / speed);
    return () => { clearInterval(timer); clearInterval(spawner); };
  }, []); // eslint-disable-line

  useEffect(() => { if (timeLeft === 0) onFinish({ correct, total: correct + misses, won: correct >= 10, headline: `${correct} moles bopped!` }); }, [timeLeft]); // eslint-disable-line

  function bonk(hole) {
    const mole = moles[hole];
    if (!mole || mole.bonked || mole.qKey !== question.q) return;
    const right = mole.choice === question.answer;
    chime(right);
    onAnswer(right);
    if (right) {
      setCorrect((c) => c + 1);
      setFlash("✅");
      setMoles(Array(9).fill(null));
      setQuestion(draw());
    } else {
      setMisses((m) => m + 1);
      setFlash("❌");
      setMoles((hs) => hs.map((m, i) => (i === hole ? { ...m, bonked: true } : m)));
    }
    setTimeout(() => setFlash(null), 500);
  }

  return (
    <Frame title="Whack-a-Mole" color={color} onExit={onExit} stats={<>🔨 {correct} · ⏱ {timeLeft}s</>}>
      <QuestionCard question={question} color={color} speak={speak} compact />
      <div className="text-xs font-bold text-center mb-2" style={{ color: MUTED }}>Bop the mole holding the right answer! {flash}</div>
      <div className="grid grid-cols-3 gap-2.5 rounded-3xl p-3" style={{ background: "#8BC48A" }}>
        {moles.map((m, i) => (
          <button key={i} onClick={() => bonk(i)} className="relative rounded-full flex items-end justify-center overflow-hidden" style={{ height: 96, background: "#5C3D2E" }} data-mole={m ? question.choices[m.choice] : ""}>
            {m && m.qKey === question.q && (
              <div className="pop absolute inset-x-1 bottom-1 rounded-t-full flex flex-col items-center justify-start pt-1" style={{ height: 84, background: m.bonked ? "#9C8B83" : "#B98B6E" }}>
                <div className="text-xl leading-none">{m.bonked ? "😵" : "🐹"}</div>
                <div className="mt-1 px-1.5 py-0.5 rounded-md font-black text-[11px] leading-tight text-center" style={{ background: "#fff", color: INK, maxWidth: "95%", wordBreak: "break-word" }}>{question.choices[m.choice]}</div>
              </div>
            )}
          </button>
        ))}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- Racing
function Racing({ questions, color, speak, chime, onAnswer, onFinish, onExit, calm }) {
  const FINISH = 100;
  const STEP = 10; // a right answer moves you 10% of the track
  const BOT_SECONDS = calm ? 150 : 105; // how long the computer racers take
  const draw = useDeck(questions);
  const [question, setQuestion] = useState(() => draw());
  const [player, setPlayer] = useState(0);
  const [bots, setBots] = useState(() => [0, 0, 0]);
  const [botSpeeds] = useState(() => [0.85, 1, 1.12].map((f) => (FINISH / BOT_SECONDS) * f * (0.95 + Math.random() * 0.1)));
  const [feedback, setFeedback] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [streak, setStreak] = useState(0);
  const done = useRef(false);
  useReadAloud(question, speak);

  useEffect(() => {
    const tick = 200;
    const id = setInterval(() => setBots((bs) => bs.map((b, i) => Math.min(FINISH, b + botSpeeds[i] * (tick / 1000) * gameSpeed()))), tick);
    return () => clearInterval(id);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (done.current) return;
    const leader = Math.max(...bots);
    if (player >= FINISH || leader >= FINISH) {
      done.current = true;
      const place = 1 + bots.filter((b) => b > player || (b >= FINISH && player < FINISH)).length;
      const ord = ["1st", "2nd", "3rd", "4th"][place - 1];
      setTimeout(() => onFinish({ correct, total: correct + wrong, won: place === 1, headline: place === 1 ? "You won the race! 🏁" : `You finished ${ord}!` }), 600);
    }
  }, [player, bots]); // eslint-disable-line

  function pick(i) {
    if (feedback || done.current) return;
    const right = i === question.answer;
    chime(right);
    onAnswer(right);
    setFeedback({ picked: i, answer: question.answer });
    if (right) {
      const boost = STEP + (streak >= 2 ? 3 : 0);
      setPlayer((p) => Math.min(FINISH, p + boost));
      setCorrect((c) => c + 1);
      setStreak((s) => s + 1);
    } else {
      setWrong((w) => w + 1);
      setStreak(0);
    }
    setTimeout(() => { setFeedback(null); setQuestion(draw()); }, (right ? 500 : 1300) / gameSpeed());
  }

  const lanes = [{ name: "You", pos: player, car: "🏎️", me: true }, ...bots.map((b, i) => ({ name: ["Turbo", "Zoom", "Dash"][i], pos: b, car: ["🚙", "🚕", "🚓"][i] }))];
  return (
    <Frame title="Racing" color={color} onExit={onExit} stats={streak >= 2 ? `🔥 Boost x${streak}` : `✔ ${correct}`}>
      <div className="rounded-2xl p-2 mb-3" style={{ background: "#4A4E57" }}>
        {lanes.map((l) => (
          <div key={l.name} className="relative h-11 my-1 rounded-lg" style={{ background: l.me ? "#5E6470" : "#555A64", borderRight: "6px dashed #fff" }}>
            <div className="absolute left-1.5 top-0.5 text-[9px] font-black" style={{ color: l.me ? "#FFE79A" : "#C9CED6" }}>{l.name}</div>
            <div className="absolute top-2 text-2xl" data-racer={l.name} data-pos={Math.round(l.pos)} style={{ left: `calc(${(l.pos / FINISH) * 86}% + 2px)`, transition: "left 300ms", transform: "scaleX(-1)" }}>{l.car}</div>
            <div className="absolute right-1 top-2 text-lg">🏁</div>
          </div>
        ))}
      </div>
      <QuestionCard question={question} color={color} speak={speak} compact />
      <Choices question={question} onPick={pick} feedback={feedback} />
      <p className="text-[11px] text-center mt-2" style={{ color: MUTED }}>Right answers move your car. 3 in a row = turbo boost!</p>
    </Frame>
  );
}

// ---------------------------------------------------------------- Maze Chase
// Wordwall-style: four corner zones are labelled A-D; run to the zone with
// the right answer. Ghosts chase you. Arrow keys, the on-screen pad, or swipes.
const MAZE = [
  "A....#.....B",
  ".##.##.###..",
  ".#.......#..",
  "...##.#....#",
  "##....#.##..",
  "...#.P...#..",
  ".#.#.##.#...",
  ".#.......##.",
  "...##.#.....",
  ".#....#.###.",
  ".###..#.....",
  "C..........D",
];
const MAZE_ROWS = MAZE.length;
const MAZE_COLS = MAZE[0].length;
function mazeCell(r, c) { return r >= 0 && c >= 0 && r < MAZE_ROWS && c < MAZE_COLS && MAZE[r][c] !== "#"; }
function findInMaze(ch) {
  for (let r = 0; r < MAZE_ROWS; r++) { const c = MAZE[r].indexOf(ch); if (c >= 0) return { r, c }; }
  return null;
}
const MAZE_START = findInMaze("P");
const MAZE_ZONES = LETTERS.map((L) => findInMaze(L));
// Ghosts restart on the side walls, away from the routes to the answer
// zones, and wait a moment after every restart so it stays fair.
const GHOST_STARTS = [{ r: 5, c: 0 }, { r: 6, c: 11 }];
const GHOST_WAIT_MS = 1500;
// Next step from `from` toward `to` along open cells (breadth-first search).
function stepToward(from, to) {
  const key = (p) => `${p.r},${p.c}`;
  const prev = { [key(from)]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.r === to.r && cur.c === to.c) break;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { r: cur.r + dr, c: cur.c + dc };
      if (mazeCell(n.r, n.c) && !(key(n) in prev)) { prev[key(n)] = cur; queue.push(n); }
    }
  }
  let cur = to;
  if (!(key(cur) in prev)) return from;
  while (prev[key(cur)] && !(prev[key(cur)].r === from.r && prev[key(cur)].c === from.c)) cur = prev[key(cur)];
  return prev[key(cur)] ? cur : from;
}

function MazeChase({ questions, color, speak, chime, onAnswer, onFinish, onExit, calm }) {
  const GOAL = 8;
  const GHOST_MS = calm ? 1000 : 700;
  const draw = useDeck(questions);
  const [question, setQuestion] = useState(() => draw());
  const [pos, setPos] = useState(MAZE_START);
  const [ghosts, setGhosts] = useState(GHOST_STARTS);
  const [lives, setLives] = useState(3);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [message, setMessage] = useState("Run to the letter with the right answer!");
  const posRef = useRef(pos);
  const over = useRef(false);
  const touch = useRef(null);
  const ghostsWaitUntil = useRef(Date.now() + GHOST_WAIT_MS);
  function resetGhosts() { setGhosts(GHOST_STARTS); ghostsWaitUntil.current = Date.now() + GHOST_WAIT_MS / gameSpeed(); }
  useReadAloud(question, speak);
  useEffect(() => { posRef.current = pos; }, [pos]);

  function loseLife(why) {
    chime(false);
    setMessage(why);
    setLives((l) => l - 1);
    setPos(MAZE_START);
    resetGhosts();
  }

  // Ghosts: mostly chase, sometimes wander, so it stays fair for younger kids.
  useEffect(() => {
    const id = setInterval(() => {
      if (over.current || Date.now() < ghostsWaitUntil.current) return;
      setGhosts((gs) => gs.map((g) => {
        if (Math.random() < 0.65) return stepToward(g, posRef.current);
        const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dr, dc]) => ({ r: g.r + dr, c: g.c + dc })).filter((n) => mazeCell(n.r, n.c));
        return opts[Math.floor(Math.random() * opts.length)] || g;
      }));
    }, GHOST_MS / gameSpeed());
    return () => clearInterval(id);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (over.current) return;
    if (ghosts.some((g) => g.r === pos.r && g.c === pos.c)) loseLife("👻 A ghost got you! Back to the start.");
  }, [ghosts, pos]); // eslint-disable-line

  useEffect(() => {
    if (over.current) return;
    const zone = MAZE_ZONES.findIndex((z) => z.r === pos.r && z.c === pos.c);
    if (zone < 0 || zone >= question.choices.length) return;
    const right = zone === question.answer;
    onAnswer(right);
    if (right) {
      chime(true);
      setCorrect((c) => c + 1);
      setMessage("✅ Yes! Next question.");
      setQuestion(draw());
      resetGhosts();
      setPos(MAZE_START);
    } else {
      setWrong((w) => w + 1);
      loseLife(`❌ Not ${LETTERS[zone]}. The answer was ${LETTERS[question.answer]}: ${question.choices[question.answer]}`);
    }
  }, [pos]); // eslint-disable-line

  useEffect(() => {
    if (over.current) return;
    if (lives <= 0 || correct >= GOAL) {
      over.current = true;
      onFinish({ correct, total: correct + wrong, won: correct >= GOAL, headline: correct >= GOAL ? "You escaped the maze!" : "The ghosts won this time!" });
    }
  }, [lives, correct]); // eslint-disable-line

  const move = useCallback((dr, dc) => {
    if (over.current) return;
    setPos((p) => (mazeCell(p.r + dr, p.c + dc) ? { r: p.r + dr, c: p.c + dc } : p));
  }, []);

  useEffect(() => {
    const keys = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    function onKey(e) { if (keys[e.key]) { e.preventDefault(); move(...keys[e.key]); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  function onTouchEnd(e) {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x, dy = t.clientY - touch.current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 20) { if (Math.abs(dx) > Math.abs(dy)) move(0, dx > 0 ? 1 : -1); else move(dy > 0 ? 1 : -1, 0); }
    touch.current = null;
  }

  const zoneColors = ["#5B9BD1", "#D98551", "#6FAE8B", "#E8B84B"];
  return (
    <Frame title="Maze Chase" color={color} onExit={onExit} stats={<>{"❤️".repeat(Math.max(0, lives))} · {correct}/{GOAL}</>}>
      <QuestionCard question={question} color={color} speak={speak} compact />
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        {question.choices.map((c, i) => (
          <div key={i} className="text-xs font-bold px-2 py-1.5 rounded-lg" style={{ background: `${zoneColors[i]}22`, color: INK, border: `2px solid ${zoneColors[i]}` }}><b>{LETTERS[i]}</b> {c}</div>
        ))}
      </div>
      <div className="rounded-2xl p-1.5 mx-auto" style={{ background: "#1F1A3D", touchAction: "none", maxWidth: 360 }}
        onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }} onTouchEnd={onTouchEnd}>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${MAZE_COLS}, 1fr)` }} data-maze>
          {MAZE.map((row, r) => row.split("").map((ch, c) => {
            const zone = MAZE_ZONES.findIndex((z) => z.r === r && z.c === c);
            const isGhost = ghosts.some((g) => g.r === r && g.c === c);
            const isMe = pos.r === r && pos.c === c;
            return (
              <div key={`${r}-${c}`} data-cell={`${r},${c}`} data-wall={ch === "#" ? "1" : "0"}
                className="flex items-center justify-center font-black" style={{ aspectRatio: "1", fontSize: 15,
                  background: ch === "#" ? "#4B3F8F" : zone >= 0 && zone < question.choices.length ? zoneColors[zone] : "#1F1A3D", color: "#fff", borderRadius: ch === "#" ? 3 : 0 }}>
                {isMe ? <span data-player>😃</span> : isGhost ? "👻" : zone >= 0 && zone < question.choices.length ? LETTERS[zone] : ch === "#" ? "" : <span style={{ color: "#6B60A8", fontSize: 6 }}>●</span>}
              </div>
            );
          }))}
        </div>
      </div>
      <div className="text-xs font-bold text-center my-2" style={{ color: MUTED, minHeight: 16 }}>{message}</div>
      <div className="grid grid-cols-3 gap-1.5 mx-auto" style={{ maxWidth: 200 }}>
        <div /><button onClick={() => move(-1, 0)} aria-label="Up" className="kbtn py-2.5 rounded-xl font-black" style={{ background: LINE }}>▲</button><div />
        <button onClick={() => move(0, -1)} aria-label="Left" className="kbtn py-2.5 rounded-xl font-black" style={{ background: LINE }}>◀</button>
        <button onClick={() => move(1, 0)} aria-label="Down" className="kbtn py-2.5 rounded-xl font-black" style={{ background: LINE }}>▼</button>
        <button onClick={() => move(0, 1)} aria-label="Right" className="kbtn py-2.5 rounded-xl font-black" style={{ background: LINE }}>▶</button>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- Tower Defense
// Blooket's most-played mode: answers earn gold, gold builds and upgrades
// towers on the slots beside the path, towers stop the monster waves.
const TD_COLS = 10, TD_ROWS = 7, TD_CELL = 34;
const TD_PATH = [[0, 1], [7, 1], [7, 3], [2, 3], [2, 5], [9, 5]].map(([c, r]) => ({ x: (c + 0.5) * TD_CELL, y: (r + 0.5) * TD_CELL }));
const TD_SLOTS = [[2, 0], [5, 0], [8, 2], [5, 2], [1, 2], [4, 4], [7, 4], [1, 6], [5, 6], [8, 6]].map(([c, r]) => ({ x: (c + 0.5) * TD_CELL, y: (r + 0.5) * TD_CELL }));
const TD_SEGMENTS = TD_PATH.slice(1).map((p, i) => ({ a: TD_PATH[i], b: p, len: Math.hypot(p.x - TD_PATH[i].x, p.y - TD_PATH[i].y) }));
const TD_LENGTH = TD_SEGMENTS.reduce((s, g) => s + g.len, 0);
function tdPoint(dist) {
  let d = dist;
  for (const s of TD_SEGMENTS) {
    if (d <= s.len) return { x: s.a.x + ((s.b.x - s.a.x) * d) / s.len, y: s.a.y + ((s.b.y - s.a.y) * d) / s.len };
    d -= s.len;
  }
  return TD_PATH[TD_PATH.length - 1];
}
const TD_TOWER = [null, { cost: 50, range: 62, damage: 1, reload: 900 }, { cost: 60, range: 72, damage: 2, reload: 750 }, { cost: 80, range: 84, damage: 3, reload: 600 }];
const TD_WAVES = 5;

function TowerDefense({ questions, color, speak, chime, onAnswer, onFinish, onExit, calm }) {
  const draw = useDeck(questions);
  const [question, setQuestion] = useState(() => draw());
  const [feedback, setFeedback] = useState(null);
  const [gold, setGold] = useState(60);
  const [lives, setLives] = useState(10);
  const [wave, setWave] = useState(0); // waves started
  const [running, setRunning] = useState(false);
  const [towers, setTowers] = useState({}); // slot index -> level
  const [selected, setSelected] = useState(null);
  const [, force] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const enemies = useRef([]);
  const shots = useRef([]);
  const toSpawn = useRef(0);
  const spawnClock = useRef(0);
  const cooldowns = useRef({});
  const towersRef = useRef(towers);
  const over = useRef(false);
  useReadAloud(question, speak);
  useEffect(() => { towersRef.current = towers; }, [towers]);

  function startWave() {
    if (running || over.current) return;
    const n = wave + 1;
    setWave(n);
    toSpawn.current = 4 + n * 2;
    spawnClock.current = 0;
    setRunning(true);
  }

  useEffect(() => {
    if (!running) return;
    const TICK = 50;
    const id = setInterval(() => {
      const dt = TICK * gameSpeed();
      const speed = (calm ? 22 : 30) + wave * 2; // px per second
      // spawn
      spawnClock.current -= dt;
      if (toSpawn.current > 0 && spawnClock.current <= 0) {
        const hp = 2 + wave;
        enemies.current.push({ id: Math.random(), dist: 0, hp, max: hp, kind: ["👾", "🐛", "👹", "🦇", "🐲"][wave - 1] || "👾" });
        toSpawn.current -= 1;
        spawnClock.current = 1100;
      }
      // move
      let leaked = 0;
      enemies.current.forEach((e) => { e.dist += (speed * dt) / 1000; });
      enemies.current = enemies.current.filter((e) => { if (e.dist >= TD_LENGTH) { leaked++; return false; } return true; });
      // towers shoot the enemy furthest along the path within range
      let earned = 0;
      shots.current = shots.current.filter((s) => (s.ttl -= dt) > 0);
      Object.entries(towersRef.current).forEach(([slot, level]) => {
        const t = TD_TOWER[level];
        const pos = TD_SLOTS[slot];
        cooldowns.current[slot] = (cooldowns.current[slot] || 0) - dt;
        if (cooldowns.current[slot] > 0) return;
        const target = enemies.current
          .map((e) => ({ e, p: tdPoint(e.dist) }))
          .filter(({ p }) => Math.hypot(p.x - pos.x, p.y - pos.y) <= t.range)
          .sort((a, b) => b.e.dist - a.e.dist)[0];
        if (!target) return;
        target.e.hp -= t.damage;
        shots.current.push({ from: pos, to: target.p, ttl: 120 });
        cooldowns.current[slot] = t.reload;
      });
      enemies.current = enemies.current.filter((e) => { if (e.hp <= 0) { earned += 5; return false; } return true; });
      if (earned) setGold((g) => g + earned);
      if (leaked) setLives((l) => Math.max(0, l - leaked));
      if (toSpawn.current === 0 && enemies.current.length === 0) setRunning(false);
      force((n) => n + 1);
    }, TICK);
    return () => clearInterval(id);
  }, [running]); // eslint-disable-line

  useEffect(() => {
    if (over.current) return;
    if (lives <= 0) { over.current = true; onFinish({ correct, total: correct + wrong, won: false, headline: `The monsters got through on wave ${wave}!` }); }
    else if (!running && wave >= TD_WAVES) { over.current = true; onFinish({ correct, total: correct + wrong, won: true, headline: "You defended the castle! 🏰" }); }
  }, [lives, running]); // eslint-disable-line

  function pick(i) {
    if (feedback) return;
    const right = i === question.answer;
    chime(right);
    onAnswer(right);
    setFeedback({ picked: i, answer: question.answer });
    if (right) { setGold((g) => g + 25); setCorrect((c) => c + 1); } else setWrong((w) => w + 1);
    setTimeout(() => { setFeedback(null); setQuestion(draw()); }, (right ? 450 : 1300) / gameSpeed());
  }

  function build(slot) {
    const level = towers[slot] || 0;
    const nextT = TD_TOWER[level + 1];
    if (!nextT) { setSelected(null); return; }
    if (gold < nextT.cost) { setSelected(slot); return; }
    setGold((g) => g - nextT.cost);
    setTowers((t) => ({ ...t, [slot]: level + 1 }));
    setSelected(null);
  }

  const pathD = TD_PATH.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const towerEmoji = ["", "🏹", "🗼", "🏰"];
  return (
    <Frame title="Tower Defense" color={color} onExit={onExit} stats={<>🪙 {gold} · ❤️ {lives}</>}>
      <div className="flex items-center justify-between text-xs font-black mb-1.5" style={{ color: MUTED }}>
        <span>Wave {Math.max(1, wave)} of {TD_WAVES}</span>
        <span>Tower 🏹 50 · upgrade 60 / 80</span>
      </div>
      <svg viewBox={`0 0 ${TD_COLS * TD_CELL} ${TD_ROWS * TD_CELL}`} className="w-full rounded-2xl mb-2" style={{ background: "#8BC48A" }} data-td>
        <path d={pathD} stroke="#D8C39A" strokeWidth={TD_CELL * 0.8} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <text x={TD_PATH[TD_PATH.length - 1].x - 6} y={TD_PATH[TD_PATH.length - 1].y + 8} fontSize="20">🏰</text>
        {TD_SLOTS.map((s, i) => {
          const level = towers[i] || 0;
          const nextT = TD_TOWER[level + 1];
          const affordable = nextT && gold >= nextT.cost;
          return (
            <g key={i} onClick={() => build(i)} style={{ cursor: "pointer" }} data-slot={i} data-level={level}>
              <circle cx={s.x} cy={s.y} r={TD_CELL * 0.45} fill={level ? "#6B5A44" : affordable ? "#FFF6D6" : "#B9D9B0"} stroke={selected === i ? "#D9432F" : affordable ? "#E8B84B" : "#7FAF7A"} strokeWidth="2.5" strokeDasharray={level ? "" : "3 3"} />
              <text x={s.x} y={s.y + 6} fontSize={level ? 18 : 13} textAnchor="middle">{level ? towerEmoji[level] : "+"}</text>
            </g>
          );
        })}
        {shots.current.map((s, i) => <line key={i} x1={s.from.x} y1={s.from.y} x2={s.to.x} y2={s.to.y} stroke="#FFE79A" strokeWidth="3" />)}
        {enemies.current.map((e) => {
          const p = tdPoint(e.dist);
          return (
            <g key={e.id} data-enemy>
              <text x={p.x} y={p.y + 7} fontSize="20" textAnchor="middle">{e.kind}</text>
              <rect x={p.x - 12} y={p.y - 16} width="24" height="4" fill="#00000044" />
              <rect x={p.x - 12} y={p.y - 16} width={24 * (e.hp / e.max)} height="4" fill="#D9432F" />
            </g>
          );
        })}
      </svg>
      {selected !== null && TD_TOWER[(towers[selected] || 0) + 1] && (
        <div className="text-xs font-bold text-center mb-1.5" style={{ color: "#D9432F" }}>Need {TD_TOWER[(towers[selected] || 0) + 1].cost} 🪙 — answer questions to earn more!</div>
      )}
      {!running && wave < TD_WAVES && (
        <button onClick={startWave} className="kbtn w-full py-2.5 rounded-xl font-black text-white mb-2" style={{ background: color }}>
          ▶ Start Wave {wave + 1} {wave === 0 ? "(build towers on the + spots first!)" : ""}
        </button>
      )}
      <QuestionCard question={question} color={color} speak={speak} compact />
      <Choices question={question} onPick={pick} feedback={feedback} />
      <p className="text-[11px] text-center mt-2" style={{ color: MUTED }}>Each right answer = +25 🪙. Tap a + spot to build, tap a tower to upgrade.</p>
    </Frame>
  );
}

const GAME_COMPONENTS = { gameshow: GameShow, whack: WhackAMole, racing: Racing, maze: MazeChase, tower: TowerDefense };

// Plays one game, then shows the result. Coins: 1 per right answer, +5 for a win.
export function ArcadeGame({ gameId, questions, speak, chime, onAnswer, onReward, onExit, calm }) {
  const game = ARCADE_GAMES.find((g) => g.id === gameId);
  const [result, setResult] = useState(null);
  const [runKey, setRunKey] = useState(0);
  const Game = GAME_COMPONENTS[gameId];

  function finish(r) {
    const coins = r.correct + (r.won ? 5 : 0);
    setResult({ ...r, coins });
    onReward(coins, r);
  }

  if (result) {
    return <GameOver game={game} {...result} onExit={onExit} onReplay={() => { setResult(null); setRunKey((k) => k + 1); }} />;
  }
  return (
    <Game key={runKey} questions={questions} color={game.color} speak={speak} chime={chime} calm={calm}
      onAnswer={onAnswer} onFinish={finish} onExit={onExit} />
  );
}

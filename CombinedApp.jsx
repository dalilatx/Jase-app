import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Volume2, Star, CheckCircle2, XCircle, ArrowRight, Trophy, Pencil, ClipboardCheck,
  RotateCcw, Home, BookOpen, Calculator, Coffee, Wind, LayoutGrid, Sparkles, BookMarked, ArrowLeft,
  ListOrdered, Flame, BarChart3, Clock, ArrowLeftRight, MessageCircle, Send, RefreshCw, Smile, FileText
} from "lucide-react";
import { supabase } from "./supabaseClient";


// --- Shared sound effects (Web Audio, no external assets, no TTS dependency) ---
// --- Live AI tutor helpers (shared by reading & math sections) ---
async function askClaude(prompt, maxTokens) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens || 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = (data.content || []).map((b) => b.text || "").join("\n").trim();
    return text || null;
  } catch (e) {
    return null;
  }
}
function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch (e) {} }
  return null;
}

function playChime(correct) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = correct ? [523.25, 659.25, 783.99] : [392, 329.63];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });
    setTimeout(() => ctx.close(), 900);
  } catch (e) {}
}

// --- Shared app-wide settings: text size, dyslexia-friendly spacing, calm game mode ---
const SETTINGS_KEY = "combined-app-settings";
let appSettings = { fontScale: "normal", dyslexiaSpacing: false, calmMode: false };
function getCalmMode() { return appSettings.calmMode; }

async function loadAppSettings() {
  try {
    const res = await window.storage.get(SETTINGS_KEY);
    if (res && res.value) appSettings = { ...appSettings, ...JSON.parse(res.value) };
  } catch (e) {}
  return appSettings;
}
async function saveAppSettings(next) {
  appSettings = { ...appSettings, ...next };
  try { await window.storage.set(SETTINGS_KEY, JSON.stringify(appSettings)); } catch (e) {}
  return appSettings;
}

// --- Shared milestone badges, computed from existing progress data ---
const MASTERY_THRESHOLDS = [10, 20, 30, 40];
const STREAK_THRESHOLDS = [3, 7, 14];
function computeBadges(progress, streakDays) {
  const totalMastered = Object.values(progress).reduce((sum, g) => sum + (g.mastered ? g.mastered.length : 0), 0);
  const badges = [];
  MASTERY_THRESHOLDS.forEach((t) => badges.push({ id: `mastery-${t}`, label: `${t} Mastered`, icon: "⭐", unlocked: totalMastered >= t }));
  STREAK_THRESHOLDS.forEach((t) => badges.push({ id: `streak-${t}`, label: `${t}-Day Streak`, icon: "🔥", unlocked: streakDays >= t }));
  return badges;
}

function BadgeRow({ badges }) {
  return (
    <div className="grid grid-cols-4 gap-2 mb-2">
      {badges.map((b) => (
        <div key={b.id} className="rounded-xl p-2 flex flex-col items-center gap-1 text-center" style={{ background: b.unlocked ? "#fff" : "#F3F3F0", border: `2px solid ${b.unlocked ? "#E8B84B" : "#E5E5E0"}`, opacity: b.unlocked ? 1 : 0.45 }}>
          <div className="text-xl">{b.icon}</div>
          <div className="text-[9px] font-bold leading-tight" style={{ color: "#2B2250" }}>{b.label}</div>
        </div>
      ))}
    </div>
  );
}

// --- Activity tracking: records each answer/interaction so we can show a focus timeline and pace ---
// ===================== ANALYTICS =====================
// One compact store powers every stat in the Progress Report.
// Note: this only starts accumulating from the moment it's added — it can't
// reconstruct history from before, so trend views need a week or two to fill in.
const ANALYTICS_KEY = "combined-app-analytics";
const emptyAnalytics = () => ({
  missCounts: {},     // "reading:2:because" -> times missed
  modeUsage: {},      // "learn" -> times opened
  dailyLog: {},       // "2026-07-19" -> { seconds, correct, total }
  hourAccuracy: {},   // "14" -> { correct, total }
  testHistory: [],    // [{ date, subject, grade, score, total }]
  snapshots: [],      // [{ date, readingMastered, mathMastered }]
});

let analyticsCache = null;

async function loadAnalytics() {
  if (analyticsCache) return analyticsCache;
  let data = emptyAnalytics();
  try {
    const res = await window.storage.get(ANALYTICS_KEY);
    if (res && res.value) data = { ...data, ...JSON.parse(res.value) };
  } catch (e) {}
  analyticsCache = data;
  return data;
}
async function saveAnalytics(data) {
  analyticsCache = data;
  try { await window.storage.set(ANALYTICS_KEY, JSON.stringify(data)); } catch (e) {}
}
async function bumpAnalytics(mutator) {
  const data = await loadAnalytics();
  mutator(data);
  await saveAnalytics(data);
}

function logAnswer(correct) {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const hour = String(now.getHours());
  bumpAnalytics((d) => {
    if (!d.dailyLog[day]) d.dailyLog[day] = { seconds: 0, correct: 0, total: 0 };
    d.dailyLog[day].total += 1;
    if (correct) d.dailyLog[day].correct += 1;
    if (!d.hourAccuracy[hour]) d.hourAccuracy[hour] = { correct: 0, total: 0 };
    d.hourAccuracy[hour].total += 1;
    if (correct) d.hourAccuracy[hour].correct += 1;
  });
}
function logMiss(subjectKey, grade, item) {
  const key = `${subjectKey}:${grade}:${item}`;
  bumpAnalytics((d) => { d.missCounts[key] = (d.missCounts[key] || 0) + 1; });
}
function logModeOpen(mode) {
  if (!mode || mode === "home" || mode === "report") return;
  bumpAnalytics((d) => { d.modeUsage[mode] = (d.modeUsage[mode] || 0) + 1; });
}
function logSeconds(seconds) {
  if (!seconds || seconds < 1) return;
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  bumpAnalytics((d) => {
    if (!d.dailyLog[day]) d.dailyLog[day] = { seconds: 0, correct: 0, total: 0 };
    d.dailyLog[day].seconds += seconds;
  });
}
function logTest(subjectKey, grade, score, total) {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  bumpAnalytics((d) => {
    d.testHistory.push({ date: day, subject: subjectKey, grade, score, total });
    if (d.testHistory.length > 100) d.testHistory = d.testHistory.slice(-100);
  });
}
function logSnapshot(readingMastered, mathMastered) {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  bumpAnalytics((d) => {
    const existing = d.snapshots.find((s) => s.date === day);
    if (existing) { existing.readingMastered = readingMastered; existing.mathMastered = mathMastered; }
    else d.snapshots.push({ date: day, readingMastered, mathMastered });
    if (d.snapshots.length > 180) d.snapshots = d.snapshots.slice(-180);
  });
}

function formatMinutes(totalSeconds) {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function recordActivity(storageKey, correct) {
  try {
    const res = await window.storage.get(storageKey);
    let log = [];
    if (res && res.value) log = JSON.parse(res.value);
    log.push({ t: Date.now(), correct });
    logAnswer(correct);
    if (log.length > 500) log = log.slice(-500);
    await window.storage.set(storageKey, JSON.stringify(log));
  } catch (e) {}
}

function computePace(log) {
  if (!log || log.length === 0) return 0;
  const now = Date.now();
  const recent = log.filter((e) => now - e.t <= 15 * 60 * 1000);
  if (recent.length === 0) return 0;
  const spanMs = Math.max(now - recent[0].t, 60000);
  const correctCount = recent.filter((e) => e.correct).length;
  return Math.round((correctCount / spanMs) * 60000 * 10) / 10;
}

function FocusTimeline({ log, activeColor, idleColor }) {
  const now = Date.now();
  const slots = Array.from({ length: 15 }).map((_, i) => {
    const slotStart = now - (14 - i) * 60000;
    const slotEnd = slotStart + 60000;
    const active = (log || []).some((e) => e.t >= slotStart && e.t < slotEnd);
    return active;
  });
  return (
    <div>
      <div className="flex gap-1 mb-1.5">
        {slots.map((active, i) => (
          <div key={i} className="flex-1 rounded-sm" style={{ height: 24, background: active ? activeColor : idleColor, opacity: active ? 1 : 0.5 }} />
        ))}
      </div>
      <div className="flex justify-between text-[9px] font-bold" style={{ color: "#8B8499" }}>
        <span>15 min ago</span>
        <span>now</span>
      </div>
    </div>
  );
}

// --- Weekly lesson plan: rotates the featured words/facts and activity by calendar week ---
function weekIndex() { return Math.floor(Date.now() / 604800000); }
function pickWeeklyFocus(list, count, salt) {
  if (!list || list.length === 0) return [];
  const start = ((weekIndex() + salt) * count) % list.length;
  const picked = [];
  for (let i = 0; i < count; i++) picked.push(list[(start + i) % list.length]);
  return picked;
}
function pickWeeklyMode(modes, salt) {
  return modes[(weekIndex() + salt) % modes.length];
}

const WORD_LISTS = {
  K: ["a", "and", "away", "big", "blue", "can", "come", "down", "find", "for", "funny", "go", "help", "here", "I", "in", "is", "it", "jump", "little", "look", "make", "me", "my", "not", "one", "play", "red", "run", "said", "see", "the", "three", "to", "two", "up", "we", "where", "yellow", "you"],
  "1": ["after", "again", "an", "any", "as", "ask", "by", "could", "every", "fly", "from", "give", "going", "had", "has", "her", "him", "his", "how", "just", "know", "let", "live", "may", "of", "old", "once", "open", "over", "put", "round", "some", "stop", "take", "thank", "them", "then", "think", "walk", "were"],
  "2": ["always", "around", "because", "been", "before", "best", "both", "buy", "call", "cold", "does", "don't", "fast", "first", "five", "found", "gave", "goes", "green", "its", "made", "many", "off", "or", "pull", "read", "right", "sing", "sit", "sleep", "tell", "their", "these", "those", "upon", "us", "use", "very", "wash", "which"],
  "3": ["about", "better", "bring", "carry", "clean", "cut", "done", "draw", "drink", "eight", "fall", "far", "full", "got", "grow", "hold", "hot", "hurt", "if", "keep", "kind", "laugh", "light", "long", "much", "myself", "never", "only", "own", "pick", "seven", "shall", "show", "six", "small", "start", "ten", "today", "together", "try"],
  "4": ["although", "answer", "beautiful", "believe", "caught", "certain", "climbed", "complete", "decided", "different", "double", "eight", "enough", "example", "favorite", "finally", "however", "important", "island", "knowledge", "measure", "minute", "mountain", "neighbor", "ocean", "peculiar", "probably", "question", "receive", "rhythm", "sentence", "special", "straight", "surprise", "though", "thought", "through", "usually", "weather", "whole"],
  "5": ["accident", "achieve", "although", "argument", "assistant", "beginning", "believe", "business", "calendar", "century", "certainly", "conscience", "definitely", "describe", "different", "disappear", "embarrass", "environment", "especially", "familiar", "frequently", "government", "guarantee", "immediately", "independent", "interrupt", "necessary", "occasion", "opposite", "particular", "possess", "privilege", "recommend", "restaurant", "rhythm", "separate", "similar", "success", "temperature", "vegetable"],
};

const GRADE_LABEL = { K: "Kindergarten", "1": "1st Grade", "2": "2nd Grade", "3": "3rd Grade", "4": "4th Grade", "5": "5th Grade" };
const GRADE_COLOR = { K: "#5B9BD1", "1": "#6FAE8B", "2": "#D98551", "3": "#8E7CC3", "4": "#3D6E96", "5": "#B5643A" };

const STORIES = {
  K: [
    {
      title: "The Big Red Ball",
      question: { prompt: "What color was the ball?", options: ["Red", "Blue", "Yellow"], correct: 0 },
      scene: "ball",
      text: "I see a big red ball. Is it little? No, it is not little! Can we play? Come here and play with me. We can run. We can jump up. Look, the ball can go up, up, up! Where did it go? I see it! Here it is. You and I can play all day.",
    },
    {
      title: "Three Little Yellow Birds",
      question: { prompt: "What color were the birds?", options: ["Blue", "Yellow", "Green"], correct: 1 },
      scene: "birds",
      text: "Look up! I see three little birds. They are yellow and blue. One bird can go away. Where did it go? I see it! It is here. Can you find the other two? Come and look with me. We can find them. Here they are! We can play in the sun.",
    },
    {
      title: "My Funny Dog",
      question: { prompt: "What did the dog do?", options: ["Jumped up and down", "Went to sleep", "Ate dinner"], correct: 0 },
      scene: "dog",
      text: "I have a dog. My dog is funny! He can jump up and down. Down, down, down he goes. Then up, up, up! Look at my dog go. Can you see him? Yes, I see him! Come here, dog. We can play. I like my funny dog.",
    },
  ],
  "1": [
    {
      title: "The Flying Kite",
      question: { prompt: "What did the kite do at the park?", options: ["It flew high", "It broke", "It got wet"], correct: 0 },
      scene: "kite",
      text: "Every day I fly my kite. It is an old, round kite. My dad has one too. He said, let's fly them together. Then we walk over to the park. We put the kites up high. Once, my kite got stuck. I had to think of how to get it down. I gave a little pull and it came free. Just then, some wind came by. My kite could fly again! Thank you, wind.",
    },
    {
      title: "Grandma's Old Garden",
      question: { prompt: "What did the child help Grandma do?", options: ["Work in the garden", "Bake a cake", "Clean the house"], correct: 0 },
      scene: "garden",
      text: "By the old fence, my grandma has a garden. Every spring, she would ask me to help. Could you give me a hand? I know just what to do. First, I open the gate. Then I take my little shovel. Some flowers need water. Others need me to stop and pull weeds. Over by the fence, an old rose grows tall. My grandma said, thank you for your help. Once we are done, we sit and think about how much fun we had.",
    },
    {
      title: "The Lost Puppy",
      question: { prompt: "Who found the puppy's owner?", options: ["An old man", "A teacher", "A police officer"], correct: 0 },
      scene: "puppy",
      text: "Once, a little puppy got lost. He did not know his way home. Let me help you, I said. I put him in my arms. We walk from house to house. Has anyone seen this puppy? I would ask. Every person said no. Then, an old man came by. He said, that puppy is mine! Thank you for finding him. I was happy to help. Just then, the puppy licked my face. I think he was thanking me too.",
    },
  ],
  "2": [
    {
      title: "The Best Day Ever",
      question: { prompt: "Where did the family go?", options: ["The fair", "The beach", "School"], correct: 0 },
      scene: "fair",
      text: "It was the best day of the year because the fair had come to town. My little sister and I always look forward to it. First, we go on a fast ride. Then we walk around and look at the animals. Both of us want to buy cotton candy, but it costs five dollars. We found some money in our pockets. Which one do you want? asked the man. We could not decide, so we got one to share. Before we left, we watched a green bird sing. It was the best day we had had in a very long time.",
    },
    {
      title: "Grandpa's Garden Tale",
      question: { prompt: "What did Grandpa say the hills used to be covered in?", options: ["Green", "Snow", "Sand"], correct: 0 },
      scene: "hills",
      text: "Grandpa told us these stories many times, but we never got tired of them. Long ago, he would begin, these hills were covered in green. He said the winters were very cold, and it would snow before the sun came up. His family did not have much, so they had to use what they found. They would wash their clothes by the river and read books at night. Right before bed, he would tell us to sleep well and always dream big. His stories made us want to sit and listen for hours.",
    },
    {
      title: "The Missing Kitten",
      question: { prompt: "Where was the kitten found?", options: ["In the bushes", "Under the bed", "In a tree"], correct: 0 },
      scene: "kitten",
      text: "Our kitten was gone! We did not know where she went. Let's call for her, said Mom. We went around the yard and called her name. Because it was getting cold outside, we knew we had to hurry. Off in the bushes, we heard a tiny sound. It was our kitten! She had been stuck there the whole time. Don't worry, I said, picking her up. You are safe now. We gave her a warm bath to wash off the dirt. That night, she curled up and went right to sleep.",
    },
  ],
  "3": [
    {
      title: "The Treehouse Plan",
      question: { prompt: "What did they need to finish the treehouse?", options: ["More wood", "More rope", "More paint"], correct: 0 },
      scene: "treehouse",
      text: "Today we tried to build a treehouse together. We had to carry the boards far across the yard. My brother is much better at hammering than I am, so he did that part. I would hold the wood and keep it straight. We did not laugh when a board fall down, because we were only halfway done. After about seven trips, we grew tired. If we want to finish, we need to bring more wood tomorrow. Never give up, my brother said. So we will try again in the light of morning.",
    },
    {
      title: "The Long Hike",
      question: { prompt: "Why did they stop walking?", options: ["To drink water", "It got dark", "They got lost"], correct: 0 },
      scene: "hills",
      text: "The trail was long, and the sun was hot. We had to keep going, but I wanted to stop. Only ten more minutes, said Dad. I did not believe him. My legs hurt and my shoes were full of dirt. Finally, we found a small stream and stopped to drink. The cold water was the best thing I had ever tasted. We sat together and looked far out over the valley. It was a kind of quiet you never get at home. Today was hard, but I am glad we did it.",
    },
    {
      title: "Cleaning Out the Garage",
      question: { prompt: "What did they find in the box?", options: ["Old drawings", "Money", "A toy car"], correct: 0 },
      scene: "garage",
      text: "Mom asked us to clean the garage today. We had to cut open dozens of old boxes. Most were full of things nobody wanted to keep. But then I found a small box with my name on it. Inside were drawings I made when I was six. I had to laugh at how bad they were. Mom said she saved them because they were special to her. We showed them to Dad, and he grinned. Now the garage is clean, and we hung my old drawings on the wall.",
    },
  ],
  "4": [
    {
      title: "The Science Fair Surprise",
      question: { prompt: "Why was her project different?", options: ["She measured the results herself", "It was the biggest", "It cost the most"], correct: 0 },
      scene: "science",
      text: "Maya was probably the most nervous person in the whole gym. Her project was not the largest one there, and it was certainly not the most beautiful. But she had spent a complete month measuring how different amounts of light affected her plants. She had written down every answer she found, even the surprising ones. When the judges came, she explained her rhythm of checking the plants each morning. Although her hands shook, her voice stayed straight and clear. The judges asked question after question. Finally, one of them smiled. Real science, he said, is exactly this.",
    },
    {
      title: "The Mountain Trail",
      question: { prompt: "What made them turn back?", options: ["The weather changed", "They ran out of food", "It got too dark"], correct: 0 },
      scene: "hills",
      text: "The trail up the mountain was steeper than anyone expected. Our neighbor had climbed it before and said it was important to start early. We had enough water and food for the whole day. About halfway up, the weather began to change. Dark clouds moved across the sky, and the temperature dropped quickly. Although we wanted to reach the top, Dad said we had to decide. Getting caught in a storm on a narrow trail is dangerous. So we turned around. It was disappointing, but usually the right choice is not the easy one.",
    },
    {
      title: "The Island Letter",
      question: { prompt: "Who wrote the letter in the bottle?", options: ["A girl from another island", "A sailor", "Nobody knows"], correct: 0 },
      scene: "ocean",
      text: "We found the bottle washed up on the beach after the storm. Inside was a letter, folded into a small square. The handwriting was different from ours, and some words were hard to read. Whoever wrote it lived on an island across the ocean. She described her favorite place to watch the weather roll in, and asked whoever found the letter to write back. We could not believe it. Mom helped us find the island on a map. That afternoon, we wrote a complete answer, sealed it up, and mailed it. Now we are waiting.",
    },
  ],
  "5": [
    {
      title: "The Restaurant Job",
      question: { prompt: "What did he learn from the job?", options: ["How to work with a team", "How to cook", "How to save money"], correct: 0 },
      scene: "restaurant",
      text: "My older sister got me a job helping at the restaurant where she works. I was definitely nervous on the first day. The kitchen has its own rhythm, and everyone knows their particular role. At the beginning, I was frequently in the way. It would embarrass me when someone had to interrupt their work to move around me. But the head cook was patient. It is necessary, he said, to watch before you act. By the end of the week, I could anticipate what people needed. That, more than anything, was the real success.",
    },
    {
      title: "The Independent Study",
      question: { prompt: "Why did her topic change?", options: ["Her first idea was too broad", "She lost interest", "Her teacher said no"], correct: 0 },
      scene: "science",
      text: "For our independent study, we could choose any topic we wanted. I decided to research how temperature affects the local environment. My teacher immediately recommended that I narrow it down. Your idea is interesting, she said, but it is far too broad to describe well. At first I was frustrated. But when I began reading, I understood. There was so much information that I could not possibly cover all of it. So I chose one particular question about a single stream near my house. It was a much better project because of it.",
    },
    {
      title: "The Argument",
      question: { prompt: "How did they resolve the disagreement?", options: ["They each listened to the other side", "One person gave in", "They stopped talking"], correct: 0 },
      scene: "school",
      text: "My friend and I had a serious argument about the class project. We had completely opposite ideas about how to begin. I was certain my approach was correct, and she was equally certain about hers. For two days we barely spoke, which was embarrassing for both of us. Finally, our teacher suggested something simple. Each of you, she said, describe the other person's idea back to them. It felt strange, but it worked. I realized her plan solved a problem mine did not. In the end, we combined them, and the project was better than either version.",
    },
  ],
};


// ============================================================
// UPPER GRADES (4th-5th): all four subjects, Albert-style
// lesson-first layout, with Jase's voice + activities layered on.
// ============================================================
const UPPER_SUBJECTS = {
  math:    { label: "Math",           color: "#3D6E96", tagline: "Multiplication, fractions & decimals" },
  english: { label: "English",        color: "#B5643A", tagline: "Reading, grammar & writing" },
  science: { label: "Science",        color: "#4F8A6B", tagline: "Life, earth & physical science" },
  social:  { label: "Social Studies", color: "#8E7CC3", tagline: "History, geography & civics" },
};
const UPPER_GRADES = ["4", "5"];
const UPPER_GRADE_LABEL = { "4": "4th Grade", "5": "5th Grade" };

const UPPER_CONTENT = {
  math: {
    "4": [
      { id: "m4mult", title: "Multi-Digit Multiplication",
        lesson: "When you multiply a big number, you break it into friendlier pieces. For 23 x 4, split 23 into 20 and 3: multiply 20 x 4 = 80, then 3 x 4 = 12, then add them to get 92. This works because multiplying is just repeated adding, so you can split a number apart, multiply each piece, and put it back together. The standard algorithm you stack on paper is doing exactly this, just written more compactly.",
        cards: [
          { q: "What is 23 x 4?", a: "92" },
          { q: "What is 15 x 6?", a: "90" },
          { q: "Break 34 x 5 into two easier parts.", a: "30 x 5 = 150, plus 4 x 5 = 20, so 170" },
          { q: "What is 12 x 12?", a: "144" },
          { q: "Why can you split a number apart when multiplying?", a: "Because multiplying is repeated addition, so the pieces add back to the same total." },
        ]},
      { id: "m4div", title: "Long Division",
        lesson: "Division asks how many equal groups fit inside a number. For 144 divided by 12, you are asking how many 12s fit into 144 — the answer is 12. A helpful trick is to think of the matching multiplication: if 12 x 12 = 144, then 144 divided by 12 = 12. When numbers get big, you work left to right, dividing one place value at a time and carrying the remainder along.",
        cards: [
          { q: "What is 144 divided by 12?", a: "12" },
          { q: "What is 96 divided by 8?", a: "12" },
          { q: "What is a remainder?", a: "The amount left over when a number does not divide evenly." },
          { q: "What is 175 divided by 7?", a: "25" },
          { q: "How can multiplication help you check a division answer?", a: "Multiply the answer by the divisor — you should get the original number back." },
        ]},
      { id: "m4frac", title: "Fractions & Equivalence",
        lesson: "Two fractions are equivalent when they name the same amount, even though the numbers look different. 1/2 and 2/4 are equivalent because both mean half. You can find equivalent fractions by multiplying or dividing the top and bottom by the same number — as long as you do it to both, the value does not change. To compare fractions with different bottoms, rewrite them so the denominators match.",
        cards: [
          { q: "Is 1/2 the same as 2/4?", a: "Yes — they are equivalent fractions." },
          { q: "Write 3/4 as an equivalent fraction with a denominator of 8.", a: "6/8" },
          { q: "Which is bigger: 2/3 or 3/4?", a: "3/4 (rewrite as 8/12 and 9/12)" },
          { q: "Simplify 6/9.", a: "2/3" },
          { q: "How do you find an equivalent fraction?", a: "Multiply or divide the numerator and denominator by the same number." },
        ]},
      { id: "m4dec", title: "Decimals & Place Value",
        lesson: "Decimals are another way to write fractions whose denominators are 10, 100, or 1000. The first place after the decimal point is tenths, the next is hundredths. So 0.7 means 7 tenths, or 7/10, and 0.25 means 25 hundredths, or 25/100 which simplifies to 1/4. When comparing decimals, line up the decimal points and compare place by place, starting from the left.",
        cards: [
          { q: "What does 0.7 mean as a fraction?", a: "7/10" },
          { q: "Write 0.25 as a simplified fraction.", a: "1/4" },
          { q: "Which is larger: 0.5 or 0.45?", a: "0.5" },
          { q: "What is the first place after the decimal point called?", a: "The tenths place" },
          { q: "Write 3/10 as a decimal.", a: "0.3" },
        ]},
    ],
    "5": [
      { id: "m5ops", title: "Order of Operations",
        lesson: "When a problem has several operations, everyone has to solve it in the same order or we would all get different answers. The order is: Parentheses, Exponents, Multiplication and Division left to right, then Addition and Subtraction left to right. So in 3 + 4 x 2, you multiply first to get 8, then add 3 for 11 — not 14. The letters PEMDAS help you remember the sequence.",
        cards: [
          { q: "What does PEMDAS stand for?", a: "Parentheses, Exponents, Multiplication/Division, Addition/Subtraction" },
          { q: "Solve: 3 + 4 x 2", a: "11" },
          { q: "Solve: (3 + 4) x 2", a: "14" },
          { q: "Solve: 20 - 6 / 2", a: "17" },
          { q: "Why does everyone need the same order of operations?", a: "So the same problem always gives the same answer." },
        ]},
      { id: "m5frac", title: "Adding & Subtracting Fractions",
        lesson: "You can only add or subtract fractions when the pieces are the same size — that means the denominators must match. For 1/2 + 1/3, rewrite both with a denominator of 6: 3/6 + 2/6 = 5/6. Finding a common denominator usually means finding a number both denominators divide into. Once the bottoms match, you add or subtract only the tops and leave the denominator alone.",
        cards: [
          { q: "What is 1/2 + 1/3?", a: "5/6" },
          { q: "What is 3/4 - 1/4?", a: "1/2" },
          { q: "Why do denominators need to match before adding?", a: "Because you can only combine pieces that are the same size." },
          { q: "What is a common denominator for 1/3 and 1/4?", a: "12" },
          { q: "What is 2/5 + 1/5?", a: "3/5" },
        ]},
      { id: "m5dec", title: "Multiplying & Dividing Decimals",
        lesson: "To multiply decimals, ignore the decimal points at first and multiply as if they were whole numbers. Then count how many digits came after the decimal points in the problem, and put that many decimal places in your answer. For 0.3 x 0.4, multiply 3 x 4 = 12, and since there were two decimal places total, the answer is 0.12. Dividing by a decimal works best if you shift both numbers until the divisor becomes a whole number.",
        cards: [
          { q: "What is 0.3 x 0.4?", a: "0.12" },
          { q: "What is 1.5 x 4?", a: "6" },
          { q: "How do you know where the decimal point goes in your answer?", a: "Count the total decimal places in both numbers you multiplied." },
          { q: "What is 2.4 divided by 2?", a: "1.2" },
          { q: "What is 0.5 x 0.5?", a: "0.25" },
        ]},
      { id: "m5vol", title: "Volume & the Coordinate Plane",
        lesson: "Volume measures how much space a solid fills, and for a rectangular box it is length x width x height. A box 2 by 3 by 4 holds 24 cubic units, because you are filling three dimensions instead of covering a flat surface. The coordinate plane is a different tool: two number lines crossing at the origin, where a point is named by an ordered pair like (3, 2) — always the across number first, then the up number.",
        cards: [
          { q: "What is the formula for the volume of a rectangular prism?", a: "length x width x height" },
          { q: "A box is 2 x 3 x 4. What is its volume?", a: "24 cubic units" },
          { q: "What units are used for volume?", a: "Cubic units" },
          { q: "In the point (3, 2), which number is the x-coordinate?", a: "3 — it tells you how far across" },
          { q: "What is the origin on a coordinate plane?", a: "The point (0, 0), where the two number lines cross." },
        ]},
    ],
  },
  english: {
    "4": [
      { id: "e4pos", title: "Parts of Speech",
        lesson: "Every word in a sentence has a job. Nouns name people, places, things, or ideas. Verbs show action or state of being. Adjectives describe nouns, and adverbs describe verbs — adverbs often end in -ly. Pronouns stand in for nouns so you are not repeating the same name over and over. Knowing which job a word is doing helps you fix your own sentences when something sounds wrong.",
        cards: [
          { q: "What is a noun?", a: "A person, place, thing, or idea" },
          { q: "What is a verb?", a: "A word that shows action or state of being" },
          { q: "What does an adjective describe?", a: "A noun" },
          { q: "What does an adverb usually describe, and how does it often end?", a: "A verb, and it often ends in -ly" },
          { q: "Why do we use pronouns?", a: "To replace a noun so we are not repeating it constantly." },
        ]},
      { id: "e4struct", title: "Text Structure",
        lesson: "Authors organize information in predictable patterns, and spotting the pattern helps you follow the point. Chronological order tells events in time order. Cause and effect shows why something happened and what resulted. Compare and contrast shows how two things are alike and different. Problem and solution states a difficulty, then how it was solved. Signal words like first, because, however, and instead often give the pattern away.",
        cards: [
          { q: "What is chronological order?", a: "Telling events in the order they happened in time" },
          { q: "What does cause and effect show?", a: "Why something happened and what resulted from it" },
          { q: "What signal word often points to a cause?", a: "Because" },
          { q: "What does compare and contrast do?", a: "Shows how two things are alike and different" },
          { q: "Why does spotting text structure help a reader?", a: "It shows how the ideas connect, so the point is easier to follow." },
        ]},
      { id: "e4fig", title: "Figurative Language",
        lesson: "Figurative language means more than the literal words. A simile compares using like or as — brave as a lion. A metaphor drops the comparison word and says one thing IS another — time is a thief. Personification gives human qualities to something that is not human — the wind whispered. Hyperbole is obvious exaggeration for effect — I have told you a million times. Writers use these to make a picture in your head.",
        cards: [
          { q: "What is a simile?", a: "A comparison using like or as" },
          { q: "What is a metaphor?", a: "A direct comparison saying one thing IS another" },
          { q: "What is personification?", a: "Giving human qualities to something non-human" },
          { q: "What is hyperbole?", a: "Extreme exaggeration used for effect" },
          { q: "Is 'the classroom was a zoo' a simile or a metaphor?", a: "A metaphor — there is no like or as" },
        ]},
      { id: "e4para", title: "Writing Strong Paragraphs",
        lesson: "A paragraph is a group of sentences about one main idea. It starts with a topic sentence that tells the reader what the paragraph is about. The middle sentences give details, examples, or evidence that support that idea. The last sentence wraps it up or connects to what comes next. If a sentence does not support the topic sentence, it probably belongs in a different paragraph.",
        cards: [
          { q: "What is a topic sentence?", a: "The sentence that states the main idea of the paragraph" },
          { q: "What do the middle sentences of a paragraph do?", a: "Give details, examples, or evidence supporting the main idea" },
          { q: "How many main ideas should one paragraph have?", a: "One" },
          { q: "What should you do with a sentence that does not fit the topic?", a: "Move it to a different paragraph or cut it." },
          { q: "What does the last sentence of a paragraph usually do?", a: "Wrap up the idea or connect to what comes next" },
        ]},
    ],
    "5": [
      { id: "e5theme", title: "Theme & Main Idea",
        lesson: "The main idea is what a text is mostly about. Theme is bigger — it is the life lesson or message underneath the story. A story about a boy who keeps trying to ride a bike has a main idea about learning to ride, but a theme about persistence. Authors rarely state theme directly; you figure it out from what characters do, what problems they face, and how those problems get resolved. Always back up a theme with evidence from the text.",
        cards: [
          { q: "What is the main idea of a text?", a: "What the text is mostly about" },
          { q: "What is theme?", a: "The underlying life lesson or message of a story" },
          { q: "How is theme different from main idea?", a: "Theme is a broader life lesson; main idea is what that specific text is about." },
          { q: "How do authors usually reveal theme?", a: "Through characters' actions, conflicts, and how they are resolved" },
          { q: "What do you need to support a theme statement?", a: "Evidence and details from the text" },
        ]},
      { id: "e5vocab", title: "Context Clues & Word Roots",
        lesson: "When you hit an unfamiliar word, the sentences around it often reveal the meaning — those hints are context clues. Sometimes a definition follows the word, sometimes an example, sometimes a contrast word like unlike or however. Word roots help too: bio means life, graph means write, chron means time, geo means earth. Between context and roots, you can usually work out a word without stopping to look it up.",
        cards: [
          { q: "What is a context clue?", a: "A hint in the surrounding text that reveals a word's meaning" },
          { q: "What does the root 'bio' mean?", a: "Life" },
          { q: "What does the root 'chron' mean?", a: "Time" },
          { q: "What does the root 'geo' mean?", a: "Earth" },
          { q: "What kind of word signals a contrast clue?", a: "Words like unlike, however, or but" },
        ]},
      { id: "e5opinion", title: "Opinion & Argument Writing",
        lesson: "Opinion writing takes a clear position and defends it. Your claim is the position you are arguing. Your reasons explain why, and your evidence — facts, examples, data — proves it. Strong writers also acknowledge the other side, then explain why their own view still holds. A weak argument just repeats an opinion louder; a strong one gives the reader something solid to weigh.",
        cards: [
          { q: "What is a claim?", a: "The position or opinion you are arguing for" },
          { q: "What is evidence?", a: "Facts, examples, or data that support your claim" },
          { q: "What is a counterargument?", a: "The opposing viewpoint" },
          { q: "Why should you mention the other side?", a: "It makes your argument fairer and more convincing." },
          { q: "What makes an argument weak?", a: "Repeating an opinion without real evidence" },
        ]},
      { id: "e5gram", title: "Grammar & Conventions",
        lesson: "A complete sentence needs a subject and a verb and expresses a full thought. A fragment is missing one of those. A run-on jams two complete sentences together without proper punctuation. Commas separate items in a list, set off introductory phrases, and join two sentences when paired with a word like and or but. Quotation marks go around exactly what someone said.",
        cards: [
          { q: "What two things does every complete sentence need?", a: "A subject and a verb" },
          { q: "What is a sentence fragment?", a: "An incomplete sentence missing a subject or verb" },
          { q: "What is a run-on sentence?", a: "Two complete sentences joined without proper punctuation" },
          { q: "Name one job a comma does.", a: "Separates items in a list (or sets off an introductory phrase)" },
          { q: "What goes inside quotation marks?", a: "Exactly what someone said" },
        ]},
    ],
  },
  science: {
    "4": [
      { id: "s4energy", title: "Energy & Motion",
        lesson: "Energy is the ability to make something happen. Kinetic energy is the energy of motion — a rolling ball has it. Potential energy is stored energy waiting to be used, like a ball held up high before you drop it. When you let go, potential energy turns into kinetic energy. Energy is never created or destroyed, it just changes form — that is the law of conservation of energy.",
        cards: [
          { q: "What is kinetic energy?", a: "The energy of motion" },
          { q: "What is potential energy?", a: "Stored energy based on position or condition" },
          { q: "What happens to a raised ball's energy when you drop it?", a: "Potential energy changes into kinetic energy" },
          { q: "What is the law of conservation of energy?", a: "Energy is never created or destroyed, only changed from one form to another." },
          { q: "What is a force?", a: "A push or a pull that can change an object's motion" },
        ]},
      { id: "s4life", title: "Plant & Animal Structures",
        lesson: "Living things have structures that help them survive. Plant roots take in water and hold the plant in place, leaves capture sunlight to make food, and stems carry water between them. Animals have structures too — sharp claws for catching food, thick fur for warmth, big eyes for seeing at night. Structures that help an organism survive in its environment are called adaptations.",
        cards: [
          { q: "What do plant roots do?", a: "Take in water and anchor the plant" },
          { q: "What do leaves do?", a: "Capture sunlight to make food" },
          { q: "What is an adaptation?", a: "A structure or trait that helps an organism survive in its environment" },
          { q: "Why might an animal have thick fur?", a: "To stay warm in a cold environment" },
          { q: "What is the job of a stem?", a: "Carry water and nutrients between roots and leaves" },
        ]},
      { id: "s4earth", title: "Earth's Changing Surface",
        lesson: "Earth's surface is always changing, sometimes fast and sometimes very slowly. Weathering breaks rock into smaller pieces. Erosion moves those pieces somewhere else, usually by water, wind, or ice. Deposition drops them in a new place, which is how sandbars and river deltas form. Fast changes come from earthquakes, volcanoes, and landslides, while slow changes can take thousands of years.",
        cards: [
          { q: "What is weathering?", a: "The breaking down of rock into smaller pieces" },
          { q: "What is erosion?", a: "The movement of broken-down rock and soil to a new place" },
          { q: "What is deposition?", a: "When moved material is dropped in a new location" },
          { q: "Name a fast change to Earth's surface.", a: "An earthquake, volcano, or landslide" },
          { q: "What usually causes erosion?", a: "Water, wind, or ice" },
        ]},
      { id: "s4waves", title: "Waves & Information",
        lesson: "A wave is a disturbance that carries energy from one place to another without carrying the material along with it. Sound travels as a wave through air, water, or solids — which is why you can hear through a wall. Light also travels in waves, and it is what lets you see. We use waves to send information: sound waves carry your voice, and light and radio waves carry signals to phones and screens.",
        cards: [
          { q: "What is a wave?", a: "A disturbance that carries energy from one place to another" },
          { q: "How does sound travel?", a: "As a wave through air, water, or solids" },
          { q: "Can sound travel through solids?", a: "Yes — that is why you can hear through a wall." },
          { q: "What lets us see objects?", a: "Light waves" },
          { q: "Name a way we use waves to send information.", a: "Sound waves carry voices; radio and light waves carry phone and TV signals." },
        ]},
    ],
    "5": [
      { id: "s5matter", title: "Matter & Its Properties",
        lesson: "Matter is anything that takes up space and has mass. It exists as solid, liquid, or gas depending on how tightly its particles are packed and how fast they move. A physical change alters the form but not the substance — melting ice is still water. A chemical change makes something new, and you can often spot it by a color change, bubbling gas, or a temperature shift. Even when matter changes, the total amount is conserved.",
        cards: [
          { q: "What is matter?", a: "Anything that takes up space and has mass" },
          { q: "What are the three main states of matter?", a: "Solid, liquid, and gas" },
          { q: "Is melting ice a physical or chemical change?", a: "Physical — it is still water" },
          { q: "Name a sign of a chemical change.", a: "Color change, gas bubbles, or a temperature change" },
          { q: "What does conservation of matter mean?", a: "The total amount of matter stays the same even when it changes form." },
        ]},
      { id: "s5eco", title: "Ecosystems & Food Webs",
        lesson: "An ecosystem is all the living and non-living things in an area interacting with each other. Producers like plants make their own food using sunlight. Consumers eat other organisms. Decomposers break down dead material and return nutrients to the soil. A food web shows how energy moves through all of these connections — and if one part disappears, everything connected to it is affected.",
        cards: [
          { q: "What is a producer?", a: "An organism that makes its own food, usually using sunlight" },
          { q: "What is a consumer?", a: "An organism that eats other organisms" },
          { q: "What is a decomposer?", a: "An organism that breaks down dead material and returns nutrients to the soil" },
          { q: "What does a food web show?", a: "How energy moves through the connections in an ecosystem" },
          { q: "Where do producers get their energy?", a: "From the sun" },
        ]},
      { id: "s5earth", title: "Earth's Systems & Water",
        lesson: "Earth has four interacting systems: the geosphere is the rock and land, the hydrosphere is all the water, the atmosphere is the air, and the biosphere is all living things. They constantly affect each other — rain from the atmosphere shapes the geosphere through erosion, and plants in the biosphere need water from the hydrosphere. Almost all of Earth's water is salt water in oceans; only a small fraction is fresh water we can actually use.",
        cards: [
          { q: "What is the geosphere?", a: "Earth's rock and land" },
          { q: "What is the hydrosphere?", a: "All of Earth's water" },
          { q: "What is the atmosphere?", a: "The layer of air surrounding Earth" },
          { q: "What is the biosphere?", a: "All living things on Earth" },
          { q: "Is most of Earth's water fresh or salt water?", a: "Salt water — fresh water is only a small fraction." },
        ]},
      { id: "s5space", title: "Space & the Solar System",
        lesson: "Earth rotates on its tilted axis once a day, which gives us day and night, and revolves around the sun once a year. The tilt is what causes seasons — not distance from the sun. The moon does not make its own light; we see sunlight reflecting off it, and the changing angle as it orbits Earth creates the phases. Stars look small only because they are extraordinarily far away.",
        cards: [
          { q: "What causes day and night?", a: "Earth rotating on its axis" },
          { q: "What causes the seasons?", a: "Earth's tilted axis as it orbits the sun" },
          { q: "Does the moon make its own light?", a: "No — we see sunlight reflecting off it." },
          { q: "What causes the phases of the moon?", a: "The changing angle of sunlight as the moon orbits Earth" },
          { q: "Why do stars look so small?", a: "Because they are extremely far away" },
        ]},
    ],
  },
  social: {
    "4": [
      { id: "so4regions", title: "U.S. Regions & Geography",
        lesson: "The United States is often divided into five regions: the Northeast, Southeast, Midwest, Southwest, and West. Each has its own landforms, climate, and economy. The Midwest has flat, fertile land that makes it a farming center. The West has mountains and deserts. Geography shapes how people live and work — you find fishing towns on coasts and ranches on open plains for reasons rooted in the land itself.",
        cards: [
          { q: "Name the five U.S. regions.", a: "Northeast, Southeast, Midwest, Southwest, and West" },
          { q: "Which region is known for fertile farmland?", a: "The Midwest" },
          { q: "How does geography affect how people work?", a: "The land and climate determine what jobs are possible, like farming, fishing, or ranching." },
          { q: "What is a landform?", a: "A natural feature of Earth's surface, like a mountain, valley, or plain" },
          { q: "What does climate mean?", a: "The average weather pattern of a place over many years" },
        ]},
      { id: "so4native", title: "Native American Cultures",
        lesson: "Native American nations lived across North America for thousands of years before Europeans arrived, and their cultures varied enormously depending on where they lived. Plains nations followed buffalo herds. Northwest Coast nations fished salmon and built with cedar. Southwest nations farmed corn in dry land and built homes from adobe. Their ways of life were shaped by the resources around them, and many of these nations continue today.",
        cards: [
          { q: "Why did Native American cultures differ across regions?", a: "Because they adapted to the different resources and climates where they lived" },
          { q: "What animal was central to Plains nations?", a: "The buffalo" },
          { q: "What did Southwest nations build homes from?", a: "Adobe" },
          { q: "What food was central to Northwest Coast nations?", a: "Salmon" },
          { q: "Do Native American nations still exist today?", a: "Yes — many nations continue today with their own governments and cultures." },
        ]},
      { id: "so4explore", title: "Early Explorers",
        lesson: "In the 1400s and 1500s, European nations sent explorers across the ocean looking for trade routes, gold, and land. Columbus reached the Americas in 1492 while searching for a route to Asia. Others followed, claiming territory for Spain, France, and England. These voyages connected continents that had been separate, but they also brought disease and conflict that devastated Native populations already living there.",
        cards: [
          { q: "Why did European nations send explorers?", a: "To find trade routes, gold, and land" },
          { q: "What year did Columbus reach the Americas?", a: "1492" },
          { q: "What was Columbus actually looking for?", a: "A sea route to Asia" },
          { q: "Name a country that claimed land in the Americas.", a: "Spain, France, or England" },
          { q: "What was one harmful effect of European arrival?", a: "Disease and conflict devastated Native American populations." },
        ]},
      { id: "so4gov", title: "Government & Citizenship",
        lesson: "Government makes and enforces the rules a community lives by. In the United States, government works at several levels: local government runs cities and towns, state government handles the state, and federal government covers the whole country. Citizens have rights, like free speech, and responsibilities, like following laws and voting when old enough. Democracy means the people hold the power, usually by electing representatives.",
        cards: [
          { q: "What are the three levels of U.S. government?", a: "Local, state, and federal" },
          { q: "What does democracy mean?", a: "The people hold the power, usually through voting" },
          { q: "Name a right citizens have.", a: "Freedom of speech" },
          { q: "Name a responsibility citizens have.", a: "Following laws and voting" },
          { q: "What does local government run?", a: "Cities and towns" },
        ]},
    ],
    "5": [
      { id: "so5colony", title: "Colonial America",
        lesson: "England established thirteen colonies along the Atlantic coast, and they developed differently depending on geography. New England colonies had rocky soil and turned to fishing, shipbuilding, and trade. Middle colonies had good farmland and grew grain. Southern colonies had warm weather and long growing seasons, leading to large plantations that relied heavily on enslaved labor — a brutal system that shaped the region for centuries.",
        cards: [
          { q: "How many original colonies were there?", a: "Thirteen" },
          { q: "Why did New England turn to fishing and trade?", a: "Because the rocky soil made large-scale farming difficult" },
          { q: "What were the Middle colonies known for growing?", a: "Grain" },
          { q: "Why did Southern colonies develop large plantations?", a: "Warm weather and long growing seasons" },
          { q: "What brutal system did Southern plantations rely on?", a: "Slavery — the forced labor of enslaved people" },
        ]},
      { id: "so5rev", title: "The American Revolution",
        lesson: "Colonists grew angry when Britain taxed them without letting them have representatives in Parliament — the complaint known as taxation without representation. Protests like the Boston Tea Party escalated tensions. In 1776 the colonies issued the Declaration of Independence, written mainly by Thomas Jefferson, formally breaking from Britain. After years of war and help from France, the colonies won and became an independent nation.",
        cards: [
          { q: "What does 'taxation without representation' mean?", a: "Being taxed by a government you have no vote in" },
          { q: "What was the Boston Tea Party?", a: "A protest where colonists dumped British tea into Boston Harbor" },
          { q: "What year was the Declaration of Independence issued?", a: "1776" },
          { q: "Who mainly wrote the Declaration of Independence?", a: "Thomas Jefferson" },
          { q: "Which country helped the colonies win the war?", a: "France" },
        ]},
      { id: "so5const", title: "The Constitution",
        lesson: "After independence, the first government under the Articles of Confederation proved too weak, so leaders wrote the Constitution in 1787. It splits power among three branches: the legislative branch makes laws, the executive branch enforces them, and the judicial branch interprets them. Checks and balances let each branch limit the others so no one gets too powerful. The Bill of Rights, the first ten amendments, protects individual freedoms.",
        cards: [
          { q: "What are the three branches of government?", a: "Legislative, executive, and judicial" },
          { q: "Which branch makes laws?", a: "The legislative branch" },
          { q: "Which branch enforces laws?", a: "The executive branch" },
          { q: "What is the Bill of Rights?", a: "The first ten amendments, protecting individual freedoms" },
          { q: "What is the purpose of checks and balances?", a: "To stop any one branch from becoming too powerful" },
        ]},
      { id: "so5west", title: "Westward Expansion",
        lesson: "Through the 1800s the United States expanded west. The Louisiana Purchase in 1803 doubled the country's size overnight. Manifest Destiny was the belief that the nation was meant to stretch across the continent, and it drove settlers westward in huge numbers. But this expansion came at enormous cost to Native American nations, who were pushed off their homelands — most infamously on the forced march known as the Trail of Tears.",
        cards: [
          { q: "What was the Louisiana Purchase?", a: "The 1803 purchase from France that doubled the size of the U.S." },
          { q: "What was Manifest Destiny?", a: "The belief that the U.S. was meant to expand across the continent" },
          { q: "What was the Trail of Tears?", a: "The forced removal of Native American nations from their homelands" },
          { q: "Who was harmed by westward expansion?", a: "Native American nations, who lost their homelands" },
          { q: "In what century did most westward expansion happen?", a: "The 1800s" },
        ]},
    ],
  },
};

function upperCards(subject, grade) {
  const out = [];
  UPPER_CONTENT[subject][grade].forEach((t) =>
    t.cards.forEach((c) => out.push({ ...c, topicId: t.id, topicTitle: t.title })));
  return out;
}

function buildUpperQuestions(cards, count) {
  const pool = shuffle(cards).slice(0, count);
  return pool.map((card) => {
    const others = cards.filter((c) => c.a !== card.a && c.q !== card.q);
    const same = card.topicId ? others.filter((c) => c.topicId === card.topicId) : others;
    const rest = card.topicId ? others.filter((c) => c.topicId !== card.topicId) : [];
    const distractors = [...shuffle(same), ...shuffle(rest)].slice(0, 3).map((c) => c.a);
    const options = shuffle([card.a, ...distractors]);
    return { ...card, options, correctIndex: options.indexOf(card.a) };
  });
}

// Like buildUpperQuestions, but the questions asked (askCards) can be a small
// missed-items set while distractors are still drawn from a wider pool, so
// options stay varied even when only a couple of cards are under review.
function buildUpperReviewQuestions(askCards, distractorPool) {
  return askCards.map((card) => {
    const others = distractorPool.filter((c) => c.a !== card.a && c.q !== card.q);
    const same = card.topicId ? others.filter((c) => c.topicId === card.topicId) : others;
    const rest = card.topicId ? others.filter((c) => c.topicId !== card.topicId) : [];
    const distractors = [...shuffle(same), ...shuffle(rest)].slice(0, 3).map((c) => c.a);
    const options = shuffle([card.a, ...distractors]);
    return { ...card, options, correctIndex: options.indexOf(card.a) };
  });
}
function findUpperCard(subject, grade, topicId, q) {
  const topic = (UPPER_CONTENT[subject][grade] || []).find((t) => t.id === topicId);
  if (!topic) return null;
  const card = topic.cards.find((c) => c.q === q);
  return card ? { ...card, topicId } : null;
}

const SENTENCE_POOLS = {
  K: [
    "I see a big red ball.",
    "We can play and run.",
    "Look, the ball can go up.",
    "I have a funny dog.",
    "Come and play with me.",
    "I see three little birds.",
  ],
  "1": [
    "I fly my kite every day.",
    "My grandma has a garden.",
    "Then we walk over to the park.",
    "He did not know his way home.",
    "I know just what to do.",
    "Some flowers need water.",
  ],
  "2": [
    "It was the best day ever.",
    "We found some money in our pockets.",
    "Grandpa told us these stories many times.",
    "The kitten had been stuck there.",
    "We always look forward to it.",
    "Right before bed, he would tell us.",
  ],
  "3": [
    "We tried to build a treehouse together.",
    "My brother is much better at hammering.",
    "Never give up, my brother said.",
    "The cold water was the best thing.",
    "Mom asked us to clean the garage today.",
    "We had to carry the boards far.",
  ],
  "4": [
    "Maya was probably the most nervous person there.",
    "Although her hands shook, her voice stayed clear.",
    "The weather began to change quickly.",
    "It is important to start early.",
    "We could not believe what we found.",
    "Usually the right choice is not the easy one.",
  ],
  "5": [
    "The kitchen has its own rhythm and pace.",
    "It is necessary to watch before you act.",
    "My teacher recommended that I narrow it down.",
    "We had completely opposite ideas about the project.",
    "I realized her plan solved a problem mine did not.",
    "That, more than anything, was the real success.",
  ],
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let selectedVoiceURI = null;
let cachedVoices = [];

function refreshVoices() {
  if (!window.speechSynthesis) return [];
  cachedVoices = window.speechSynthesis.getVoices() || [];
  return cachedVoices;
}

const VOICE_PRIORITY = ["daniel", "moira", "samantha", "karen", "tessa", "google us english", "google uk english female", "aria", "jenny", "natural"];
const AVOID_HINTS = ["compact", "novelty", "whisper", "bells", "bad news", "bubbles", "cellos", "organ", "trinoids", "zarvox", "boing"];
// iOS/macOS ship low-quality "compact" voices by default, but expose much better
// Enhanced/Premium/Siri variants once the user downloads them. Detect and prefer those.
const QUALITY_HINTS = ["premium", "enhanced", "siri", "neural", "natural"];
function voiceQualityLabel(v) {
  const n = (v.name || "").toLowerCase();
  if (n.includes("premium")) return "Premium";
  if (n.includes("enhanced")) return "Enhanced";
  if (n.includes("siri")) return "Siri";
  if (n.includes("neural") || n.includes("natural")) return "Neural";
  return null;
}
function isHighQualityVoice(v) { return QUALITY_HINTS.some((h) => (v.name || "").toLowerCase().includes(h)); }

function autoPickVoice() {
  const voices = refreshVoices();
  const english = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
  const pool = english.length ? english : voices;
  const clean = pool.filter((v) => !AVOID_HINTS.some((h) => v.name.toLowerCase().includes(h)));

  // 1. Best case: a high-quality variant of a voice she already likes.
  for (const hint of VOICE_PRIORITY) {
    const match = clean.find((v) => v.name.toLowerCase().includes(hint) && isHighQualityVoice(v));
    if (match) return match.voiceURI;
  }
  // 2. Any high-quality voice at all.
  const anyQuality = clean.find(isHighQualityVoice);
  if (anyQuality) return anyQuality.voiceURI;
  // 3. Fall back to the preferred names at standard quality.
  for (const hint of VOICE_PRIORITY) {
    const match = clean.find((v) => v.name.toLowerCase().includes(hint));
    if (match) return match.voiceURI;
  }
  const local = clean.find((v) => v.localService);
  return (local || clean[0] || pool[0] || null)?.voiceURI || null;
}

function setVoice(voiceURI) { selectedVoiceURI = voiceURI; }
function getVoiceList() { return refreshVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("en")); }
function getActiveVoice() {
  const voices = cachedVoices.length ? cachedVoices : refreshVoices();
  const uri = selectedVoiceURI || autoPickVoice();
  return voices.find((vv) => vv.voiceURI === uri) || null;
}

function speak(text, rate = 0.85) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = 1.0;
    const v = getActiveVoice();
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }, 60);
}

// Speaks a list of phrases one at a time with a real silent gap between each,
// instead of relying on punctuation for pauses (which most TTS engines rush through).
function speakSequence(parts, rate = 0.8, gapMs = 450) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const v = getActiveVoice();
  let i = 0;
  function playNext() {
    if (i >= parts.length) return;
    const u = new SpeechSynthesisUtterance(parts[i]);
    u.rate = rate;
    u.pitch = 1.0;
    if (v) u.voice = v;
    u.onend = () => { i += 1; setTimeout(playNext, gapMs); };
    window.speechSynthesis.speak(u);
  }
  setTimeout(playNext, 60);
}

// Speaks text while reporting which word (by token index in text.split(/(\s+)/))
// is currently being spoken, so the UI can highlight along in real time.
// Word-boundary events aren't supported identically on every browser — if they
// never fire, the story still reads fine, it just won't highlight.
function speakWithHighlight(text, rate, onWordIndex, onDone) {
  if (!window.speechSynthesis) { if (onDone) onDone(); return; }
  window.speechSynthesis.cancel();
  const tokens = text.split(/(\s+)/);
  const starts = [];
  let cum = 0;
  tokens.forEach((t) => { starts.push(cum); cum += t.length; });
  setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate || 0.85;
    u.pitch = 1.0;
    const v = getActiveVoice();
    if (v) u.voice = v;
    u.onboundary = (e) => {
      if (typeof e.charIndex !== "number") return;
      let idx = 0;
      for (let i = 0; i < starts.length; i++) { if (starts[i] <= e.charIndex) idx = i; else break; }
      if (onWordIndex) onWordIndex(idx);
    };
    u.onend = () => { if (onWordIndex) onWordIndex(-1); if (onDone) onDone(); };
    u.onerror = () => { if (onWordIndex) onWordIndex(-1); if (onDone) onDone(); };
    window.speechSynthesis.speak(u);
  }, 60);
}

const STORAGE_KEY = "reading-app-progress";
const STREAK_KEY = "combined-app-streak";
const SPURTS_KEY = "combined-app-spurts";
const MISSED_KEY = "reading-app-missed";
const ACTIVITY_KEY = "reading-app-activity";
const LAST_ACTIVITY_KEY = "reading-app-last-activity";
const emptyProgress = () => ({ K: { mastered: [], lastTest: null }, "1": { mastered: [], lastTest: null }, "2": { mastered: [], lastTest: null }, "3": { mastered: [], lastTest: null }, "4": { mastered: [], lastTest: null }, "5": { mastered: [], lastTest: null } });

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetween(a, b) {
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  return Math.round((d2 - d1) / 86400000);
}

const STRETCHES = [
  "Stand up tall and reach both arms to the sky. Hold for 5 seconds.",
  "Touch your toes slowly, then roll back up.",
  "Give yourself a big hug and twist gently side to side.",
  "Shake out your hands and wiggle your fingers.",
];

function ReadingSection({ onSwitchSubject }) {
  const [screen, setScreen] = useState("home");
  const [grade, setGrade] = useState("K");
  const [progress, setProgress] = useState(emptyProgress());
  const [loaded, setLoaded] = useState(false);
  const [sessionMinutes, setSessionMinutes] = useState(15);
  const [learnIndex, setLearnIndex] = useState({ K: 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 });
  const [streak, setStreak] = useState(0);
  const [spurts, setSpurts] = useState(0);
  const SPURT_TARGET = 4;
  const [onBreak, setOnBreak] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(sessionMinutes * 60);
  const [missedPool, setMissedPool] = useState([]);
  const [lastActivity, setLastActivity] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY);
        if (res && res.value) {
          // Saved data may predate grades 3-5. Merge into the full shape so
          // newly added grades don't come back undefined and crash on select.
          const saved = JSON.parse(res.value);
          setProgress({ ...emptyProgress(), ...saved });
        }
      } catch (e) {}
      setLoaded(true);
    })();
    (async () => {
      try {
        const res = await window.storage.get(MISSED_KEY);
        if (res && res.value) setMissedPool(JSON.parse(res.value));
      } catch (e) {}
    })();
    (async () => {
      try {
        const res = await window.storage.get(LAST_ACTIVITY_KEY);
        if (res && res.value) setLastActivity(JSON.parse(res.value));
      } catch (e) {}
    })();
    (async () => {
      let data = { lastActiveDate: null, currentStreak: 0, longestStreak: 0 };
      try {
        const res = await window.storage.get(STREAK_KEY);
        if (res && res.value) data = JSON.parse(res.value);
      } catch (e) {}
      const today = todayStr();
      if (data.lastActiveDate === today) {
        // already counted today
      } else if (data.lastActiveDate && daysBetween(data.lastActiveDate, today) === 1) {
        data.currentStreak += 1;
        data.lastActiveDate = today;
      } else {
        data.currentStreak = 1;
        data.lastActiveDate = today;
      }
      data.longestStreak = Math.max(data.longestStreak || 0, data.currentStreak);
      setStreak(data.currentStreak);
      try { await window.storage.set(STREAK_KEY, JSON.stringify(data)); } catch (e) {}
    })();
    (async () => {
      let sData = { date: todayStr(), count: 0 };
      try {
        const res = await window.storage.get(SPURTS_KEY);
        if (res && res.value) sData = JSON.parse(res.value);
      } catch (e) {}
      if (sData.date !== todayStr()) sData = { date: todayStr(), count: 0 };
      setSpurts(sData.count);
    })();
    if (window.speechSynthesis) {
      refreshVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        refreshVoices();
        if (!selectedVoiceURI) setVoice(autoPickVoice());
      };
      setTimeout(() => { if (!selectedVoiceURI) setVoice(autoPickVoice()); }, 300);
    }
    // Keeps the speech engine from stalling after idle periods — a known
    // mobile browser quirk that shows up as lag or dropped speech.
    const keepAlive = setInterval(() => {
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 4000);
    return () => clearInterval(keepAlive);
  }, []);

  useEffect(() => {
    if (screen === "home") setSecondsLeft(sessionMinutes * 60);
  }, [sessionMinutes]); // eslint-disable-line

  useEffect(() => {
    if (screen === "home" || onBreak) return;
    // Batch time into storage every 15s rather than every tick.
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      if (ticks % 15 === 0) logSeconds(15);
      setSecondsLeft((s) => {
        if (s <= 1) {
          setOnBreak(true);
          return sessionMinutes * 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (ticks % 15 !== 0) logSeconds(ticks % 15); clearInterval(id); };
  }, [screen, onBreak, sessionMinutes]);

  const saveProgress = useCallback(async (next) => {
    setProgress(next);
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {}
  }, []);

  const markMastered = useCallback((g, word) => {
    setProgress((prev) => {
      const cur = prev[g]?.mastered || [];
      if (cur.includes(word)) return prev;
      const next = { ...prev, [g]: { ...prev[g], mastered: [...cur, word] } };
      saveProgress(next);
      return next;
    });
  }, [saveProgress]);

  const recordTest = useCallback((g, result) => {
    logTest("reading", g, result.score, result.total);
    setProgress((prev) => {
      const next = { ...prev, [g]: { ...prev[g], lastTest: result } };
      saveProgress(next);
      return next;
    });
    if (result.missed && result.missed.length) addMisses(g, result.missed);
  }, [saveProgress]); // eslint-disable-line

  const saveMissedPool = useCallback(async (next) => {
    setMissedPool(next);
    try { await window.storage.set(MISSED_KEY, JSON.stringify(next)); } catch (e) {}
  }, []);

  function addMisses(g, words) {
    words.forEach((w) => logMiss("reading", g, w));
    setMissedPool((prev) => {
      const existingKeys = new Set(prev.map((m) => `${m.grade}:${m.word}`));
      const additions = words.filter((w) => !existingKeys.has(`${g}:${w}`)).map((w) => ({ grade: g, word: w }));
      if (additions.length === 0) return prev;
      const next = [...prev, ...additions];
      saveMissedPool(next);
      return next;
    });
  }
  function addMiss(g, word) { addMisses(g, [word]); }
  function removeMiss(g, word) {
    setMissedPool((prev) => {
      const next = prev.filter((m) => !(m.grade === g && m.word === word));
      saveMissedPool(next);
      return next;
    });
  }

  async function updateLastActivity(nextScreen, nextGrade) {
    if (nextScreen === "home" || nextScreen === "report" || nextScreen === "needsPractice") return;
    const data = { screen: nextScreen, grade: nextGrade };
    setLastActivity(data);
    try { await window.storage.set(LAST_ACTIVITY_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function goHome() {
    setScreen("home");
  }

  useEffect(() => {
    if (!loaded) return;
    updateLastActivity(screen, grade);
    logModeOpen(screen);
  }, [screen, grade, loaded]); // eslint-disable-line

  async function saveSpurts(n) {
    const clamped = Math.max(0, Math.min(SPURT_TARGET, n));
    setSpurts(clamped);
    try { await window.storage.set(SPURTS_KEY, JSON.stringify({ date: todayStr(), count: clamped })); } catch (e) {}
  }

  if (!loaded) {
    return (
      <div style={{ background: "#FFFBF2", minHeight: "100vh" }} className="flex items-center justify-center">
        <div style={{ color: "#2B2250" }} className="font-bold">Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ background: "#FFFBF2", minHeight: "100vh", fontFamily: "'Trebuchet MS', 'Verdana', sans-serif" }} className="relative">
      <style>{`
        @keyframes popIn { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
        @keyframes breathe { 0%, 100% { transform: scale(0.75); } 50% { transform: scale(1.15); } }
        .pop { animation: popIn 220ms ease-out; }
        .shakeIt { animation: shake 300ms ease-in-out; }
        .kbtn { transition: transform 100ms ease; }
        .kbtn:active { transform: scale(0.95); }
      `}</style>

      {screen === "home" && (
        <HomeScreen grade={grade} setGrade={setGrade} setScreen={setScreen} progress={progress} sessionMinutes={sessionMinutes} setSessionMinutes={setSessionMinutes} streak={streak} spurts={spurts} spurtTarget={SPURT_TARGET} setSpurts={saveSpurts} onSwitchSubject={onSwitchSubject} missedCount={missedPool.length} lastActivity={lastActivity} />
      )}
      {screen === "learn" && (
        <LearnMode grade={grade} onExit={goHome} onMaster={markMastered} onMiss={addMiss} idx={learnIndex[grade]} setIdx={(i) => setLearnIndex((prev) => ({ ...prev, [grade]: i }))} />
      )}
      {screen === "test" && <TestMode grade={grade} onExit={goHome} onFinish={(r) => recordTest(grade, r)} />}
      {screen === "memory" && <MemoryMatchMode grade={grade} onExit={goHome} />}
      {screen === "balloons" && <BalloonPopMode grade={grade} onExit={goHome} />}
      {screen === "stories" && <StoriesMode grade={grade} onExit={goHome} />}
      {screen === "sentences" && <SentenceBuilderMode grade={grade} onExit={goHome} />}
      {screen === "report" && <ProgressReport progress={progress} onExit={goHome} />}
      {screen === "needsPractice" && <NeedsPracticeMode pool={missedPool} onMaster={markMastered} onSolved={removeMiss} onExit={goHome} />}
      {screen === "smartPractice" && <SmartPracticeMode grade={grade} pool={missedPool} onMaster={markMastered} onExit={goHome} />}
      {screen === "jokes" && <JokesMode grade={grade} onExit={goHome} />}

      {screen !== "home" && !onBreak && (
        <div
          className="fixed top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black"
          style={{ background: "#2B2250", color: "#fff", zIndex: 45 }}
        >
          <Clock size={12} /> {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </div>
      )}

      {onBreak && <BreakOverlay onDone={() => { setOnBreak(false); saveSpurts(spurts + 1); }} />}
    </div>
  );
}

function BreakOverlay({ onDone }) {
  const DURATION = 360;
  const [secondsLeft, setSecondsLeft] = useState(DURATION);
  const [stretchIdx] = useState(() => Math.floor(Math.random() * STRETCHES.length));

  useEffect(() => {
    speak("Great work! Time for a brain break.");
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const canContinue = secondsLeft <= 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center px-6 py-8" style={{ background: "#2B2250", minHeight: "100dvh" }}>
      <div className="max-w-sm w-full text-center text-white my-auto">
        <Coffee size={36} className="mx-auto mb-3" style={{ color: "#E8B84B" }} />
        <h2 className="text-2xl font-black mb-2">Brain Break!</h2>
        <p className="text-sm opacity-80 mb-6">Great focus so far. Let's recharge before the next round.</p>

        <div className="mx-auto mb-6 rounded-full flex items-center justify-center" style={{ width: 110, height: 110, background: "#E8B84B22", animation: "breathe 4s ease-in-out infinite" }}>
          <Wind size={36} style={{ color: "#E8B84B" }} />
        </div>

        <div className="rounded-2xl p-4 mb-4 text-left" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: "#E8B84B" }}>Stretch</div>
          <p className="text-sm">{STRETCHES[stretchIdx]}</p>
        </div>

        <div className="rounded-2xl p-4 mb-6 text-left" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: "#E8B84B" }}>Breathe</div>
          <p className="text-sm">Close your eyes. Breathe in slow for 4 counts, out for 4 counts. Some soft music can help here.</p>
        </div>

        <div className="text-3xl font-black mb-4" style={{ color: "#E8B84B" }}>
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </div>

        <button
          onClick={onDone}
          disabled={!canContinue}
          className="kbtn w-full py-3 rounded-xl font-black"
          style={{ background: canContinue ? "#E8B84B" : "rgba(255,255,255,0.15)", color: canContinue ? "#2B2250" : "rgba(255,255,255,0.5)" }}
        >
          {canContinue ? "Back to Learning" : "Resting a bit longer..."}
        </button>
      </div>
    </div>
  );
}

function TopBar({ title, color, onExit }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 sm:px-6" style={{ borderBottom: "2px solid #EEE6D6" }}>
      <button onClick={onExit} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#2B2250", background: "#EEE6D6" }}>
        <Home size={16} /> Home
      </button>
      <div className="font-black text-base sm:text-lg text-center px-2" style={{ color }}>{title}</div>
      <div style={{ width: 76 }} />
    </div>
  );
}

function VoicePicker() {
  const [voices, setVoices] = useState([]);
  const [current, setCurrent] = useState(selectedVoiceURI);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    function load() {
      const list = getVoiceList();
      // Show high-quality voices at the top of the list.
      const sorted = [...list].sort((a, b) => (isHighQualityVoice(b) ? 1 : 0) - (isHighQualityVoice(a) ? 1 : 0));
      setVoices(sorted);
      if (!current && sorted.length) setCurrent(autoPickVoice());
    }
    load();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
  }, []); // eslint-disable-line

  function choose(uri) {
    setCurrent(uri);
    setVoice(uri);
    speak("Hi! This is how I'll sound when we practice.");
  }

  if (!voices.length) return null;

  const hasQuality = voices.some(isHighQualityVoice);

  return (
    <div className="rounded-2xl p-4 mb-6" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
      <div className="font-black text-sm mb-2" style={{ color: "#2B2250" }}>Reading voice</div>
      <select
        value={current || ""}
        onChange={(e) => choose(e.target.value)}
        className="w-full text-sm font-bold py-2.5 px-3 rounded-xl outline-none mb-2"
        style={{ border: "2px solid #EEE6D6", color: "#2B2250", background: "#FFFBF2" }}
      >
        {voices.map((v) => {
          const q = voiceQualityLabel(v);
          return (
            <option key={v.voiceURI} value={v.voiceURI}>
              {q ? `★ ${v.name} (${q})` : v.name}
            </option>
          );
        })}
      </select>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => choose(current)} className="kbtn text-xs font-bold px-3 py-1.5 rounded-full" style={{ background: "#EEE6D622", color: "#8B8499", border: "1px solid #EEE6D6" }}>
          <Volume2 size={12} className="inline mr-1" /> Test this voice
        </button>
        <button onClick={() => setShowHelp((v) => !v)} className="kbtn text-xs font-bold px-3 py-1.5 rounded-full" style={{ background: hasQuality ? "#6FAE8B22" : "#D9855122", color: hasQuality ? "#4F8A6B" : "#D98551", border: `1px solid ${hasQuality ? "#6FAE8B" : "#D98551"}` }}>
          {hasQuality ? "★ Better voices found" : "Voice sounds robotic?"}
        </button>
      </div>
      {showHelp && (
        <div className="text-xs mt-3 pt-3 leading-relaxed" style={{ color: "#5B6B7A", borderTop: "1px solid #EEE6D6" }}>
          {hasQuality
            ? "Voices marked ★ are the high-quality versions installed on this device — pick one of those for the most natural sound."
            : "Your device is only using its basic built-in voices, which sound robotic. You can download much better free ones:"}
          <div className="mt-2 font-bold" style={{ color: "#2B2250" }}>On iPhone/iPad:</div>
          <div>Settings → Accessibility → Spoken Content → Voices → English → pick a voice (like Daniel or Moira) → tap the download icon for the <b>Enhanced</b> or <b>Premium</b> version.</div>
          <div className="mt-2 font-bold" style={{ color: "#2B2250" }}>On Android:</div>
          <div>Settings → Accessibility → Text-to-speech → install/update the Google Speech Services voice data.</div>
          <div className="mt-2">Come back here afterward and the new voices will show up marked with a ★.</div>
        </div>
      )}
    </div>
  );
}

const READING_SCREEN_LABELS = {
  learn: "Learn Words", test: "Spelling Test",
  memory: "Memory Match", balloons: "Balloon Pop", stories: "Story Time", sentences: "Sentence Builder",
};

function HomeScreen({ grade, setGrade, setScreen, progress, sessionMinutes, setSessionMinutes, streak, spurts, spurtTarget, setSpurts, onSwitchSubject, missedCount, lastActivity }) {
  const total = WORD_LISTS[grade].length;
  const gp = progress[grade] || { mastered: [], lastTest: null };
  const mastered = gp.mastered.length;
  const lastTest = gp.lastTest;

  return (
    <div className="max-w-md mx-auto px-5 pt-8 pb-10">
      <div className="flex items-center justify-between mb-4">
        {streak > 0 ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black" style={{ background: "#E8B84B22", color: "#D98551" }}>
            <Flame size={14} /> {streak} day{streak === 1 ? "" : "s"} in a row
          </div>
        ) : <div />}
        <div className="flex items-center gap-2">
          <button onClick={onSwitchSubject} className="kbtn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black" style={{ background: "#EEE6D6", color: "#2B2250" }}>
            <ArrowLeftRight size={14} /> Math
          </button>
          <button onClick={() => setScreen("report")} className="kbtn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black" style={{ background: "#EEE6D6", color: "#2B2250" }}>
            <BarChart3 size={14} /> Progress
          </button>
        </div>
      </div>

      {lastActivity && READING_SCREEN_LABELS[lastActivity.screen] && (
        <button onClick={() => { setGrade(lastActivity.grade); setScreen(lastActivity.screen); }} className="kbtn w-full rounded-2xl p-4 mb-4 flex items-center gap-3 text-left" style={{ background: "#2B2250" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
            <ArrowRight size={18} color="#fff" />
          </div>
          <div className="flex-1">
            <div className="text-white font-black text-sm">Continue: {READING_SCREEN_LABELS[lastActivity.screen]}</div>
            <div className="text-xs" style={{ color: "#C9C2D6" }}>{GRADE_LABEL[lastActivity.grade]} — pick up where you left off</div>
          </div>
        </button>
      )}

      {(() => {
        const modeKeys = Object.keys(READING_SCREEN_LABELS);
        const featuredMode = pickWeeklyMode(modeKeys, 0);
        const focusWords = pickWeeklyFocus(WORD_LISTS[grade], 6, 1);
        return (
          <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #D98551" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-black text-sm" style={{ color: "#2B2250" }}>This Week's Lesson</div>
              <button
                onClick={() => speakSequence(["This week we're focusing on these words:", ...focusWords, `Let's practice with ${READING_SCREEN_LABELS[featuredMode]}!`], 0.85, 350)}
                className="kbtn w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "#D9855122", color: "#D98551" }}
              >
                <Volume2 size={14} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {focusWords.map((w) => (
                <span key={w} className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "#FFFBF2", color: "#2B2250", border: "1px solid #EEE6D6" }}>{w}</span>
              ))}
            </div>
            <button onClick={() => setScreen(featuredMode)} className="kbtn w-full py-2.5 rounded-xl font-black text-white text-sm" style={{ background: "#D98551" }}>
              Start {READING_SCREEN_LABELS[featuredMode]}
            </button>
          </div>
        );
      })()}

      <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
        <div className="flex items-center justify-between mb-2.5">
          <div className="font-black text-sm" style={{ color: "#2B2250" }}>Today's Learning Spurts</div>
          <div className="text-xs font-bold" style={{ color: "#8B8499" }}>{spurts} of {spurtTarget}</div>
        </div>
        <div className="flex gap-2">
          {Array.from({ length: spurtTarget }).map((_, i) => {
            const filled = i < spurts;
            return (
              <button
                key={i}
                onClick={() => setSpurts(filled && i === spurts - 1 ? spurts - 1 : i + 1)}
                className="kbtn flex-1 h-10 rounded-xl flex items-center justify-center font-black text-sm"
                style={{ background: filled ? "#6FAE8B" : "#EEE6D6", color: filled ? "#fff" : "#8B8499" }}
              >
                {filled ? <CheckCircle2 size={18} /> : i + 1}
              </button>
            );
          })}
        </div>
        {spurts >= spurtTarget && (
          <div className="text-center text-xs font-bold mt-2.5" style={{ color: "#6FAE8B" }}>All done for today — great work!</div>
        )}
      </div>

      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3" style={{ background: "#D98551" }}>
          <BookOpen color="#fff" size={28} />
        </div>
        <h1 className="text-2xl font-black" style={{ color: "#2B2250" }}>Word Adventure</h1>
        <p className="text-sm mt-1" style={{ color: "#8B8499" }}>Pick a grade, then choose what to practice</p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {Object.keys(WORD_LISTS).map((g) => (
          <button key={g} onClick={() => setGrade(g)} className="kbtn py-3 rounded-xl font-black text-sm"
            style={{ background: grade === g ? GRADE_COLOR[g] : "#EEE6D6", color: grade === g ? "#fff" : "#2B2250" }}>
            {g === "K" ? "Kinder" : `${g}${g === "1" ? "st" : g === "2" ? "nd" : g === "3" ? "rd" : "th"}`}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-6 text-xs">
        <span className="font-bold" style={{ color: "#8B8499" }}>Practice session length:</span>
        {[5, 10, 15].map((m) => (
          <button key={m} onClick={() => setSessionMinutes(m)} className="kbtn px-3 py-1.5 rounded-full font-black"
            style={{ background: sessionMinutes === m ? "#2B2250" : "#EEE6D6", color: sessionMinutes === m ? "#fff" : "#2B2250" }}>
            {m} min
          </button>
        ))}
      </div>

      <VoicePicker />

      <div className="rounded-2xl p-4 mb-6 flex items-center gap-3" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
        <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: `${GRADE_COLOR[grade]}22` }}>
          <Star size={22} style={{ color: GRADE_COLOR[grade] }} fill={GRADE_COLOR[grade]} />
        </div>
        <div className="flex-1">
          <div className="font-black text-sm" style={{ color: "#2B2250" }}>{mastered} / {total} words mastered</div>
          <div className="h-2 rounded-full mt-1.5 overflow-hidden" style={{ background: "#EEE6D6" }}>
            <div className="h-full rounded-full" style={{ width: `${(mastered / total) * 100}%`, background: GRADE_COLOR[grade], transition: "width 400ms" }} />
          </div>
        </div>
      </div>

      {lastTest && (
        <div className="rounded-xl p-3 mb-6 flex items-center gap-2 text-sm font-bold" style={{ background: "#6FAE8B22", color: "#2B2250" }}>
          <Trophy size={16} style={{ color: "#6FAE8B" }} />
          Last spelling test: {lastTest.score}/{lastTest.total} correct
        </div>
      )}

      <div className="space-y-3">
        <ModeButton icon={<Volume2 size={20} />} title="Learn Words" subtitle="See it, hear it, type it" color="#5B9BD1" onClick={() => setScreen("learn")} />
        <ModeButton icon={<LayoutGrid size={20} />} title="Memory Match" subtitle="Flip cards to find matching words" color="#8E7CC3" onClick={() => setScreen("memory")} />
        <ModeButton icon={<BookMarked size={20} />} title="Story Time" subtitle="Short stories with his sight words highlighted" color="#6FAE8B" onClick={() => setScreen("stories")} />
        <ModeButton icon={<ListOrdered size={20} />} title="Sentence Builder" subtitle="Put the scrambled words in order" color="#5B9BD1" onClick={() => setScreen("sentences")} />
        {missedCount > 0 && (
          <>
            <ModeButton icon={<RotateCcw size={20} />} title={`Needs Practice (${missedCount})`} subtitle="Review words he's missed before" color="#8E5A6B" onClick={() => setScreen("needsPractice")} />
            <ModeButton icon={<Sparkles size={20} />} title="Smart Practice" subtitle="AI finds the pattern behind his mistakes" color="#B5643A" onClick={() => setScreen("smartPractice")} />
          </>
        )}
        <ModeButton icon={<Smile size={20} />} title="Joke Time" subtitle="A silly joke using his sight words" color="#E8B84B" onClick={() => setScreen("jokes")} />
        <ModeButton icon={<Sparkles size={20} />} title="Balloon Pop" subtitle="Pop the balloon with the right word" color="#E8B84B" onClick={() => setScreen("balloons")} />
        <ModeButton icon={<ClipboardCheck size={20} />} title="Spelling Test" subtitle="Just listen and spell — no peeking" color="#D98551" onClick={() => setScreen("test")} />
      </div>
    </div>
  );
}

function ModeButton({ icon, title, subtitle, color, onClick }) {
  return (
    <button onClick={onClick} className="kbtn w-full rounded-2xl p-4 flex items-center gap-4 text-left" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}22`, color }}>{icon}</div>
      <div className="flex-1">
        <div className="font-black text-base" style={{ color: "#2B2250" }}>{title}</div>
        <div className="text-xs" style={{ color: "#8B8499" }}>{subtitle}</div>
      </div>
      <ArrowRight size={18} style={{ color: "#C9C2D6" }} />
    </button>
  );
}

function LearnMode({ grade, onExit, onMaster, onMiss, idx, setIdx }) {
  const order = WORD_LISTS[grade];
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState(null);
  const [tip, setTip] = useState(null);
  const [tipLoading, setTipLoading] = useState(false);
  const inputRef = useRef(null);
  const word = order[idx];
  const color = GRADE_COLOR[grade];

  useEffect(() => {
    speak(word);
    setTyped("");
    setStatus(null);
    setTip(null);
    setTipLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [idx, word]);

  async function getPhonicsTip() {
    setTipLoading(true);
    const prompt = `A young child learning to read (${GRADE_LABEL[grade]}) was asked to spell the word "${word}" and typed "${typed.trim() || "(nothing)"}" instead. In 1-2 short, warm, simple sentences (spoken directly to the child, plain language, no jargon), explain the specific sound or letter pattern in "${word}" that's probably tricky, and give one quick tip to remember it.`;
    const reply = await askClaude(prompt, 200);
    setTipLoading(false);
    setTip(reply || "Let's try sounding it out slowly, one letter at a time.");
    if (reply) speak(reply, 0.9);
  }

  function check() {
    if (typed.trim().toLowerCase() === word.toLowerCase()) {
      setStatus("correct");
      onMaster(grade, word);
      playChime(true);
      recordActivity(ACTIVITY_KEY, true);
      speak("Great job!");
    } else {
      setStatus("wrong");
      playChime(false);
      recordActivity(ACTIVITY_KEY, false);
      if (onMiss) onMiss(grade, word);
    }
  }
  function next() {
    if (idx + 1 < order.length) setIdx(idx + 1); else onExit();
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <TopBar title={`Learn · ${GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
      <div className="px-5 pt-6 text-center">
        <div className="text-xs font-bold mb-4" style={{ color: "#8B8499" }}>Word {idx + 1} of {order.length}</div>
        <div key={word} className="pop rounded-3xl py-10 px-6 mb-5" style={{ background: "#fff", border: `3px solid ${color}` }}>
          <div className="text-5xl font-black tracking-wide mb-4" style={{ color: "#2B2250" }}>{word}</div>
          <button onClick={() => speak(word)} className="kbtn inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm" style={{ background: `${color}22`, color }}>
            <Volume2 size={16} /> Hear it again
          </button>
        </div>
        <div className="text-xs font-bold mb-2 text-left" style={{ color: "#8B8499" }}>Now type the word:</div>
        <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (status === "correct" ? next() : check())}
          className={`w-full text-center text-xl font-bold py-3 rounded-xl mb-3 outline-none ${status === "wrong" ? "shakeIt" : ""}`}
          style={{ border: `2px solid ${status === "correct" ? "#6FAE8B" : status === "wrong" ? "#D98551" : "#EEE6D6"}`, color: "#2B2250" }} placeholder="type here" />
        {status === "correct" && <div className="flex items-center justify-center gap-2 font-bold mb-4" style={{ color: "#6FAE8B" }}><CheckCircle2 size={18} /> Correct! Nice work.</div>}
        {status === "wrong" && (
          <div className="mb-4">
            <div className="flex items-center justify-center gap-2 font-bold mb-2" style={{ color: "#D98551" }}><XCircle size={18} /> Try again — sound it out</div>
            {!tip && !tipLoading && (
              <button onClick={getPhonicsTip} className="kbtn inline-flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-full" style={{ background: "#D9855122", color: "#D98551", border: "1px solid #D98551" }}>
                <Sparkles size={12} /> Why is this tricky?
              </button>
            )}
            {tipLoading && <div className="text-xs" style={{ color: "#8B8499" }}>Thinking...</div>}
            {tip && <div className="text-sm mt-2 p-3 rounded-xl" style={{ background: "#D9855114", color: "#2B2250" }}>{tip}</div>}
          </div>
        )}
        <div className="flex gap-2">
          {status !== "correct" ? (
            <button onClick={check} className="kbtn flex-1 py-3 rounded-xl font-black text-white" style={{ background: color }}>Check</button>
          ) : (
            <button onClick={next} className="kbtn flex-1 py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: color }}>Next Word <ArrowRight size={16} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

function SmartPracticeMode({ grade, pool, onMaster, onExit }) {
  const color = "#B5643A";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [order, setOrder] = useState([]);
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState(null);
  const inputRef = useRef(null);

  async function analyze() {
    setLoading(true);
    setError(false);
    const missedWords = pool.filter((m) => m.grade === grade).map((m) => m.word);
    if (missedWords.length === 0) {
      setLoading(false);
      setError("empty");
      return;
    }
    const allWords = WORD_LISTS[grade].join(", ");
    const prompt = `A child learning to read has recently gotten these sight words wrong: ${missedWords.join(", ")}. Looking at these words, identify the single most likely shared sound or spelling pattern causing the trouble (like a specific ending, blend, or silent letter). Then, from this full word list: ${allWords} — pick up to 8 words (can include the missed ones and similar ones) that share that same pattern, best for targeted practice. Respond ONLY with JSON, no markdown fences: {"pattern": "short pattern name", "explanation": "1-2 encouraging sentences a parent could read, explaining the pattern plainly", "words": ["...", "..."]}`;
    const reply = await askClaude(prompt, 500);
    const parsed = extractJson(reply);
    setLoading(false);
    if (parsed && parsed.words && parsed.words.length > 0) {
      setAnalysis(parsed);
      const inList = parsed.words.filter((w) => WORD_LISTS[grade].includes(w));
      setOrder(shuffle(inList.length > 0 ? inList : parsed.words));
    } else {
      setError(true);
    }
  }

  useEffect(() => { analyze(); }, []); // eslint-disable-line

  useEffect(() => {
    if (order.length === 0) return;
    speak(order[idx]);
    setTyped("");
    setStatus(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [idx, order]); // eslint-disable-line

  function check() {
    const word = order[idx];
    if (typed.trim().toLowerCase() === word.toLowerCase()) {
      setStatus("correct");
      onMaster(grade, word);
      playChime(true);
      speak("Great job!");
    } else {
      setStatus("wrong");
      playChime(false);
    }
  }
  function next() {
    setTyped("");
    setStatus(null);
    if (idx + 1 < order.length) setIdx(idx + 1); else onExit();
  }

  if (loading) {
    return (
      <div className="max-w-md mx-auto pb-10">
        <TopBar title="Smart Practice" color={color} onExit={onExit} />
        <div className="px-5 pt-10 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <div className="text-sm font-bold" style={{ color: "#8B8499" }}>Looking at what's been tricky lately...</div>
        </div>
      </div>
    );
  }

  if (error === "empty") {
    return (
      <div className="max-w-md mx-auto pb-10">
        <TopBar title="Smart Practice" color={color} onExit={onExit} />
        <div className="px-5 pt-10 text-center">
          <CheckCircle2 size={48} style={{ color: "#6FAE8B" }} className="mx-auto mb-4" />
          <h2 className="text-lg font-black mb-2" style={{ color: "#2B2250" }}>Not enough data yet</h2>
          <p className="text-sm" style={{ color: "#8B8499" }}>Once he's missed a few words in Learn or Test mode, this will find the pattern behind them and build practice around it.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto pb-10">
        <TopBar title="Smart Practice" color={color} onExit={onExit} />
        <div className="px-5 pt-10 text-center">
          <div className="text-sm font-bold mb-3" style={{ color: "#D98551" }}>Couldn't reach the tutor — check your connection and try again.</div>
          <button onClick={analyze} className="kbtn px-4 py-2 rounded-xl font-black text-white" style={{ background: color }}>Try Again</button>
        </div>
      </div>
    );
  }

  const word = order[idx];

  return (
    <div className="max-w-md mx-auto pb-10">
      <TopBar title="Smart Practice" color={color} onExit={onExit} />
      <div className="px-5 pt-6">
        <div className="rounded-2xl p-4 mb-5" style={{ background: `${color}14`, border: `2px solid ${color}` }}>
          <div className="font-black text-xs uppercase tracking-widest mb-1" style={{ color }}>Pattern found: {analysis.pattern}</div>
          <p className="text-sm" style={{ color: "#2B2250" }}>{analysis.explanation}</p>
        </div>

        {word && (
          <div className="text-center">
            <div className="text-xs font-bold mb-4" style={{ color: "#8B8499" }}>Word {idx + 1} of {order.length}</div>
            <div key={word} className="pop rounded-3xl py-10 px-6 mb-5" style={{ background: "#fff", border: `3px solid ${color}` }}>
              <div className="text-5xl font-black tracking-wide mb-4" style={{ color: "#2B2250" }}>{word}</div>
              <button onClick={() => speak(word)} className="kbtn inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm" style={{ background: `${color}22`, color }}>
                <Volume2 size={16} /> Hear it again
              </button>
            </div>
            <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (status === "correct" ? next() : check())}
              className={`w-full text-center text-xl font-bold py-3 rounded-xl mb-3 outline-none ${status === "wrong" ? "shakeIt" : ""}`}
              style={{ border: `2px solid ${status === "correct" ? "#6FAE8B" : status === "wrong" ? "#D98551" : "#EEE6D6"}`, color: "#2B2250" }} placeholder="type here" />
            {status === "correct" && <div className="flex items-center justify-center gap-2 font-bold mb-4" style={{ color: "#6FAE8B" }}><CheckCircle2 size={18} /> Got it!</div>}
            {status === "wrong" && <div className="flex items-center justify-center gap-2 font-bold mb-4" style={{ color: "#D98551" }}><XCircle size={18} /> Try again</div>}
            <div className="flex gap-2">
              {status !== "correct" ? (
                <button onClick={check} className="kbtn flex-1 py-3 rounded-xl font-black text-white" style={{ background: color }}>Check</button>
              ) : (
                <button onClick={next} className="kbtn flex-1 py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: color }}>Next <ArrowRight size={16} /></button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NeedsPracticeMode({ pool, onMaster, onSolved, onExit }) {
  const color = "#8E5A6B";
  const [order] = useState(() => shuffle(pool));
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState(null);
  const inputRef = useRef(null);
  const item = order[idx];

  useEffect(() => {
    if (!item) return;
    speak(item.word);
    setTyped("");
    setStatus(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [idx]); // eslint-disable-line

  if (order.length === 0) {
    return (
      <div className="max-w-md mx-auto pb-10">
        <TopBar title="Needs Practice" color={color} onExit={onExit} />
        <div className="px-5 pt-10 text-center">
          <CheckCircle2 size={48} style={{ color: "#6FAE8B" }} className="mx-auto mb-4" />
          <h2 className="text-xl font-black mb-2" style={{ color: "#2B2250" }}>All caught up!</h2>
          <p className="text-sm" style={{ color: "#8B8499" }}>Nothing needs review right now — great work.</p>
        </div>
      </div>
    );
  }

  function check() {
    if (typed.trim().toLowerCase() === item.word.toLowerCase()) {
      setStatus("correct");
      playChime(true);
      recordActivity(ACTIVITY_KEY, true);
      onMaster(item.grade, item.word);
      onSolved(item.grade, item.word);
      speak("Great job!");
    } else {
      setStatus("wrong");
      playChime(false);
      recordActivity(ACTIVITY_KEY, false);
    }
  }
  function next() {
    if (idx + 1 < order.length) setIdx(idx + 1); else onExit();
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <TopBar title="Needs Practice" color={color} onExit={onExit} />
      <div className="px-5 pt-6 text-center">
        <div className="text-xs font-bold mb-4" style={{ color: "#8B8499" }}>Word {idx + 1} of {order.length}</div>
        <div key={idx} className="pop rounded-3xl py-10 px-6 mb-5" style={{ background: "#fff", border: `3px solid ${color}` }}>
          <div className="text-5xl font-black tracking-wide mb-4" style={{ color: "#2B2250" }}>{item.word}</div>
          <button onClick={() => speak(item.word)} className="kbtn inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm" style={{ background: `${color}22`, color }}>
            <Volume2 size={16} /> Hear it again
          </button>
        </div>
        <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (status === "correct" ? next() : check())}
          className={`w-full text-center text-xl font-bold py-3 rounded-xl mb-3 outline-none ${status === "wrong" ? "shakeIt" : ""}`}
          style={{ border: `2px solid ${status === "correct" ? "#6FAE8B" : status === "wrong" ? "#D98551" : "#EEE6D6"}`, color: "#2B2250" }} placeholder="type here" />
        {status === "correct" && <div className="flex items-center justify-center gap-2 font-bold mb-4" style={{ color: "#6FAE8B" }}><CheckCircle2 size={18} /> Got it!</div>}
        {status === "wrong" && <div className="flex items-center justify-center gap-2 font-bold mb-4" style={{ color: "#D98551" }}><XCircle size={18} /> Try again</div>}
        <div className="flex gap-2">
          {status !== "correct" ? (
            <button onClick={check} className="kbtn flex-1 py-3 rounded-xl font-black text-white" style={{ background: color }}>Check</button>
          ) : (
            <button onClick={next} className="kbtn flex-1 py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: color }}>Next <ArrowRight size={16} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

function TestMode({ grade, onExit, onFinish }) {
  const [order] = useState(() => shuffle(WORD_LISTS[grade]));
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [answers, setAnswers] = useState([]);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);
  const inputRef = useRef(null);
  const word = order[idx];
  const color = GRADE_COLOR[grade];

  useEffect(() => {
    if (started && !done) {
      speak(word);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [idx, started, done, word]);

  function submit() {
    const correct = typed.trim().toLowerCase() === word.toLowerCase();
    playChime(correct);
    recordActivity(ACTIVITY_KEY, correct);
    const nextAnswers = [...answers, { word, typed: typed.trim(), correct }];
    setAnswers(nextAnswers);
    setTyped("");
    if (idx + 1 < order.length) setIdx(idx + 1);
    else {
      const score = nextAnswers.filter((a) => a.correct).length;
      onFinish({ score, total: order.length, missed: nextAnswers.filter((a) => !a.correct).map((a) => a.word) });
      setDone(true);
    }
  }

  if (!started) {
    return (
      <div className="max-w-md mx-auto pb-10">
        <TopBar title={`Spelling Test · ${GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <ClipboardCheck size={48} style={{ color }} className="mx-auto mb-4" />
          <h2 className="text-xl font-black mb-2" style={{ color: "#2B2250" }}>Ready for your test?</h2>
          <p className="text-sm mb-6" style={{ color: "#8B8499" }}>I'll say each word out loud. You won't see it written — just listen and spell it. There are {order.length} words.</p>
          <button onClick={() => setStarted(true)} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: color }}>Start Test</button>
        </div>
      </div>
    );
  }

  if (done) {
    const score = answers.filter((a) => a.correct).length;
    return (
      <div className="max-w-md mx-auto pb-10">
        <TopBar title="Test Complete" color={color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <Trophy size={52} style={{ color: "#E8B84B" }} className="mx-auto mb-3" />
          <h2 className="text-2xl font-black mb-1" style={{ color: "#2B2250" }}>{score} / {answers.length} correct</h2>
          <p className="text-sm mb-6" style={{ color: "#8B8499" }}>{score === answers.length ? "Perfect score! Amazing work." : "Great effort — let's review the graded list below."}</p>

          <div className="text-left rounded-2xl p-4 mb-6" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
            <div className="font-black text-sm mb-3" style={{ color: "#2B2250" }}>Graded List</div>
            {answers.map((a, i) => (
              <div key={i} className="flex items-center gap-2 py-2 text-sm" style={{ borderBottom: i < answers.length - 1 ? "1px solid #EEE6D6" : "none" }}>
                <span className="font-bold w-6 shrink-0" style={{ color: "#8B8499" }}>{i + 1}.</span>
                {a.correct ? (
                  <span className="font-bold flex items-center gap-1.5" style={{ color: "#6FAE8B" }}>
                    <CheckCircle2 size={14} /> {a.word}
                  </span>
                ) : (
                  <span className="flex-1 flex items-center flex-wrap gap-x-2">
                    <span className="font-bold flex items-center gap-1.5" style={{ color: "#D9432F" }}>
                      <XCircle size={14} /> {a.typed || "(blank)"}
                    </span>
                    <span style={{ color: "#8B8499" }}>→</span>
                    <span className="font-black" style={{ color: "#2B2250" }}>{a.word}</span>
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={onExit} className="kbtn flex-1 py-3 rounded-xl font-black" style={{ background: "#EEE6D6", color: "#2B2250" }}><Home size={16} className="inline mr-1.5" /> Home</button>
            <button onClick={() => { setIdx(0); setAnswers([]); setDone(false); setStarted(true); }} className="kbtn flex-1 py-3 rounded-xl font-black text-white flex items-center justify-center gap-1.5" style={{ background: color }}><RotateCcw size={16} /> Retake</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <TopBar title={`Spelling Test · ${GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
      <div className="px-5 pt-8 text-center">
        <div className="text-xs font-bold mb-4" style={{ color: "#8B8499" }}>Question {idx + 1} of {order.length}</div>
        <div className="rounded-3xl py-12 px-6 mb-6" style={{ background: "#fff", border: `3px solid ${color}` }}>
          <button onClick={() => speak(word)} className="kbtn inline-flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: `${color}22` }}><Volume2 size={28} style={{ color }} /></div>
            <span className="text-xs font-bold" style={{ color: "#8B8499" }}>Tap to hear the word again</span>
          </button>
        </div>
        <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full text-center text-xl font-bold py-3 rounded-xl mb-4 outline-none" style={{ border: "2px solid #EEE6D6", color: "#2B2250" }}
          placeholder="spell it here" autoCapitalize="off" autoCorrect="off" spellCheck="false" />
        <button onClick={submit} className="kbtn w-full py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: color }}>Submit <ArrowRight size={16} /></button>
      </div>
    </div>
  );
}


// Cycles through the full word list in shuffled chunks, so across rounds
// every word gets used before any word repeats.
function useWordQueue(words) {
  const queueRef = useRef([]);
  function takeChunk(n) {
    const chunk = [];
    while (chunk.length < n) {
      if (queueRef.current.length === 0) queueRef.current = shuffle(words);
      chunk.push(queueRef.current.shift());
    }
    return chunk;
  }
  function takeOne() {
    if (queueRef.current.length === 0) queueRef.current = shuffle(words);
    return queueRef.current.shift();
  }
  return { takeChunk, takeOne };
}

function MemoryMatchMode({ grade, onExit }) {
  const words = WORD_LISTS[grade];
  const color = "#8E7CC3";
  const PAIRS = 6;
  const { takeChunk } = useWordQueue(words);
  const [cards, setCards] = useState(() => buildDeck(takeChunk(PAIRS)));
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const [round, setRound] = useState(1);
  const busyRef = useRef(false);

  function buildDeck(pairWords) {
    const deck = [];
    pairWords.forEach((w, i) => {
      deck.push({ id: `${i}a`, word: w });
      deck.push({ id: `${i}b`, word: w });
    });
    return shuffle(deck);
  }

  function newRound() {
    setCards(buildDeck(takeChunk(PAIRS)));
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setRound((r) => r + 1);
    busyRef.current = false;
  }

  function tapCard(idx) {
    if (busyRef.current) return;
    if (flipped.includes(idx) || matched.includes(idx)) return;
    const card = cards[idx];
    speak(card.word);
    const nextFlipped = [...flipped, idx];
    setFlipped(nextFlipped);

    if (nextFlipped.length === 2) {
      busyRef.current = true;
      setMoves((m) => m + 1);
      const [i1, i2] = nextFlipped;
      const isMatch = cards[i1].word === cards[i2].word;
      if (isMatch) {
        setTimeout(() => {
          setMatched((m) => [...m, i1, i2]);
          setFlipped([]);
          busyRef.current = false;
          playChime(true);
          recordActivity(ACTIVITY_KEY, true);
          speak("Match!");
        }, 500);
      } else {
        setTimeout(() => {
          setFlipped([]);
          busyRef.current = false;
        }, 900);
      }
    }
  }

  const allMatched = matched.length === cards.length;

  return (
    <div className="max-w-md mx-auto pb-10">
      <TopBar title={`Memory Match · ${GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
      <div className="px-5 pt-5">
        <div className="flex items-center justify-between mb-4 text-xs font-black" style={{ color: "#8B8499" }}>
          <span>Round {round}</span>
          <span>Moves: {moves}</span>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-5">
          {cards.map((card, idx) => {
            const isFlipped = flipped.includes(idx) || matched.includes(idx);
            const isMatched = matched.includes(idx);
            return (
              <button
                key={card.id}
                onClick={() => tapCard(idx)}
                className="kbtn rounded-xl flex items-center justify-center text-center font-black"
                style={{
                  height: 72,
                  background: isMatched ? "#6FAE8B22" : isFlipped ? "#fff" : color,
                  border: `2.5px solid ${isMatched ? "#6FAE8B" : color}`,
                  color: isMatched ? "#6FAE8B" : "#2B2250",
                  fontSize: isFlipped ? (card.word.length > 9 ? 10 : card.word.length > 6 ? 12 : 14) : 22,
                  lineHeight: 1.15,
                  padding: "0 4px",
                  wordBreak: "break-word",
                  opacity: isMatched ? 0.7 : 1,
                }}
              >
                {isFlipped ? card.word : "?"}
              </button>
            );
          })}
        </div>

        {allMatched && (
          <div className="rounded-2xl p-5 text-center pop" style={{ background: "#fff", border: `2px solid ${color}` }}>
            <Trophy size={36} style={{ color: "#E8B84B" }} className="mx-auto mb-2" />
            <div className="font-black text-lg mb-1" style={{ color: "#2B2250" }}>All matched in {moves} moves!</div>
            <button onClick={newRound} className="kbtn w-full py-3 rounded-xl font-black text-white mt-3 flex items-center justify-center gap-2" style={{ background: color }}>
              Next Round <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BalloonPopMode({ grade, onExit }) {
  const words = WORD_LISTS[grade];
  const color = "#E8B84B";
  const calm = getCalmMode();
  const ROUND = calm ? 65 : 45;
  const COLUMNS = ["#8E7CC3", "#5B9BD1", "#6FAE8B", "#D98551", "#E8B84B"];
  const { takeOne } = useWordQueue(words);
  const [phase, setPhase] = useState("intro");
  const [timeLeft, setTimeLeft] = useState(ROUND);
  const [score, setScore] = useState(0);
  const [target, setTarget] = useState(words[0]);
  const [balloons, setBalloons] = useState([]);
  const balloonId = useRef(0);
  const targetRef = useRef(words[0]);

  useEffect(() => { targetRef.current = target; }, [target]);

  useEffect(() => {
    if (phase !== "playing") return;
    speak(target);
    const timerId = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { setPhase("done"); return 0; }
        return t - 1;
      });
    }, 1000);
    const spawnId = setInterval(() => {
      spawnBalloon();
    }, calm ? 1700 : 1100);
    return () => { clearInterval(timerId); clearInterval(spawnId); };
  }, [phase]); // eslint-disable-line

  function spawnBalloon() {
    const id = balloonId.current++;
    const useTarget = Math.random() < 0.35;
    const word = useTarget ? targetRef.current : words[Math.floor(Math.random() * words.length)];
    const left = 8 + Math.random() * 78;
    const duration = calm ? 9 + Math.random() * 3 : 6 + Math.random() * 2.5;
    const col = COLUMNS[Math.floor(Math.random() * COLUMNS.length)];
    setBalloons((b) => [...b, { id, word, left, duration, col }]);
    setTimeout(() => {
      setBalloons((b) => b.filter((bal) => bal.id !== id));
    }, duration * 1000 + 50);
  }

  function startRound() {
    setScore(0);
    setTimeLeft(ROUND);
    setBalloons([]);
    const t = takeOne();
    setTarget(t);
    setPhase("playing");
  }

  function popBalloon(id, word) {
    if (word !== target) return;
    setScore((s) => s + 1);
    setBalloons((b) => b.filter((bal) => bal.id !== id));
    playChime(true);
    recordActivity(ACTIVITY_KEY, true);
    const t = takeOne();
    setTarget(t);
    speak(t);
  }

  if (phase === "intro") {
    return (
      <div className="max-w-md mx-auto pb-10">
        <TopBar title={`Balloon Pop · ${GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <div className="text-5xl mb-4">🎈</div>
          <h2 className="text-xl font-black mb-2" style={{ color: "#2B2250" }}>Ready to pop some words?</h2>
          <p className="text-sm mb-6" style={{ color: "#8B8499" }}>I'll say a word. Pop the balloon with that word before it floats away!</p>
          <button onClick={startRound} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: "#2B2250" }}>Start Game</button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="max-w-md mx-auto pb-10">
        <TopBar title="Game Over" color={color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <Trophy size={52} style={{ color }} className="mx-auto mb-3" />
          <h2 className="text-2xl font-black mb-1" style={{ color: "#2B2250" }}>{score} balloons popped!</h2>
          <p className="text-sm mb-6" style={{ color: "#8B8499" }}>Great job finding those words.</p>
          <div className="flex gap-2">
            <button onClick={onExit} className="kbtn flex-1 py-3 rounded-xl font-black" style={{ background: "#EEE6D6", color: "#2B2250" }}><Home size={16} className="inline mr-1.5" /> Home</button>
            <button onClick={startRound} className="kbtn flex-1 py-3 rounded-xl font-black text-white flex items-center justify-center gap-1.5" style={{ background: "#2B2250" }}><RotateCcw size={16} /> Play Again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "#FFFBF2", height: "100dvh" }}>
      <style>{`
        @keyframes floatUp { from { bottom: -12%; } to { bottom: 105%; } }
      `}</style>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "2px solid #EEE6D6", paddingRight: 84 }}>
        <button onClick={onExit} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#2B2250", background: "#EEE6D6" }}>
          <Home size={16} /> Home
        </button>
        <div className="text-xs font-black" style={{ color: "#2B2250" }}>Score: {score}</div>
        <div className="text-xs font-black" style={{ color: "#D98551" }}>⏱ {timeLeft}s</div>
      </div>

      <button onClick={() => speak(target)} className="kbtn mx-4 mt-3 rounded-2xl py-3 flex items-center justify-center gap-2 shrink-0" style={{ background: "#2B2250" }}>
        <Volume2 size={16} color="#E8B84B" />
        <span className="text-white font-black">Find: {target}</span>
      </button>

      <div className="flex-1 relative overflow-hidden mx-2 mt-2 mb-2 rounded-2xl" style={{ background: "linear-gradient(180deg, #E8F0FA, #FFFBF2)" }}>
        {balloons.map((b) => (
          <button
            key={b.id}
            onClick={() => popBalloon(b.id, b.word)}
            className="absolute flex flex-col items-center"
            style={{
              left: `${b.left}%`,
              animation: `floatUp ${b.duration}s linear forwards`,
              transform: "translateX(-50%)",
            }}
          >
            <div
              className="rounded-full flex items-center justify-center font-black px-2 shadow-md text-center leading-tight"
              style={{
                width: Math.max(74, Math.min(132, b.word.length * 9 + 26)),
                height: 88,
                fontSize: b.word.length > 9 ? 10 : b.word.length > 6 ? 11 : 12,
                background: b.col,
                color: "#fff",
                borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
                wordBreak: "break-word",
              }}
            >
              {b.word}
            </div>
            <div style={{ width: 2, height: 14, background: "#C9C2D6" }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function StoriesMode({ grade, onExit }) {
  const [openIdx, setOpenIdx] = useState(null);
  const [aiMode, setAiMode] = useState(false);
  const color = "#6FAE8B";
  const stories = STORIES[grade];

  if (aiMode) {
    return <AIStoryMode grade={grade} onExit={onExit} onBack={() => setAiMode(false)} />;
  }
  if (openIdx !== null) {
    return <StoryReader story={stories[openIdx]} grade={grade} color={color} onBack={() => setOpenIdx(null)} onExit={onExit} />;
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <TopBar title={`Story Time · ${GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
      <div className="px-5 pt-5">
        <button onClick={() => setAiMode(true)} className="kbtn w-full rounded-2xl p-4 mb-5 flex items-center gap-3 text-left" style={{ background: "#2B2250" }}>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
            <Sparkles size={20} color="#fff" />
          </div>
          <div className="flex-1">
            <div className="text-white font-black text-sm">Make Me a New Story</div>
            <div className="text-xs" style={{ color: "#C9C2D6" }}>About anything he's into — a brand new one every time</div>
          </div>
          <ArrowRight size={18} color="#fff" />
        </button>

        <p className="text-xs mb-4" style={{ color: "#8B8499" }}>
          His sight words are highlighted in each story — tap any highlighted word to hear it.
        </p>
        <div className="space-y-3">
          {stories.map((s, i) => (
            <button key={s.title} onClick={() => setOpenIdx(i)} className="kbtn w-full rounded-2xl p-3 flex items-center gap-4 text-left" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
              <div className="w-16 h-16 rounded-xl shrink-0 overflow-hidden" style={{ background: `${color}15` }}>
                <StoryIllustration scene={s.scene} />
              </div>
              <div className="flex-1">
                <div className="font-black text-base" style={{ color: "#2B2250" }}>{s.title}</div>
                <div className="text-xs" style={{ color: "#8B8499" }}>{s.text.split(" ").length} words</div>
              </div>
              <ArrowRight size={18} style={{ color: "#C9C2D6" }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const TOPIC_EMOJI = {
  dinosaur: "🦕", dinosaurs: "🦕", truck: "🚚", trucks: "🚚", car: "🚗", cars: "🚗",
  dog: "🐶", dogs: "🐶", cat: "🐱", cats: "🐱", space: "🚀", rocket: "🚀",
  animal: "🐾", animals: "🐾", princess: "👸", superhero: "🦸", superheroes: "🦸",
  dragon: "🐉", dragons: "🐉", ocean: "🌊", shark: "🦈", sharks: "🦈", robot: "🤖", robots: "🤖",
  unicorn: "🦄", unicorns: "🦄", pirate: "🏴‍☠️", pirates: "🏴‍☠️", horse: "🐴", horses: "🐴",
};
function emojiForTopic(topic) {
  const key = topic.toLowerCase().trim();
  for (const k in TOPIC_EMOJI) if (key.includes(k)) return TOPIC_EMOJI[k];
  return "✨";
}

function AIStoryMode({ grade, onExit, onBack }) {
  const color = "#6FAE8B";
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [story, setStory] = useState(null);
  const CHIPS = ["Dinosaurs", "Trucks & Cars", "My Pet", "Space", "Superheroes", "Animals"];

  async function generate(chosenTopic) {
    setLoading(true);
    setError(false);
    const words = WORD_LISTS[grade].join(", ");
    const prompt = `Write a very short story for a ${GRADE_LABEL[grade]} child learning to read, about "${chosenTopic}". Use mostly these sight words: ${words} — plus simple, short, decodable filler words. Keep it to 5-7 short, simple sentences, upbeat and fun. Then write one easy comprehension question about it with 3 multiple choice answers (only one correct). Respond ONLY with JSON, no markdown fences, in exactly this shape: {"title": "...", "text": "...", "question": {"prompt": "...", "options": ["...","...","..."], "correct": 0}}`;
    const reply = await askClaude(prompt, 700);
    const parsed = extractJson(reply);
    setLoading(false);
    if (parsed && parsed.title && parsed.text && parsed.question) {
      setStory({ ...parsed, scene: "ai", topic: chosenTopic });
    } else {
      setError(true);
    }
  }

  if (story) {
    const emoji = emojiForTopic(story.topic);
    return (
      <StoryReader
        story={story}
        grade={grade}
        color={color}
        onBack={() => setStory(null)}
        onExit={onExit}
        illustrationOverride={
          <div className="w-full h-full flex items-center justify-center text-6xl" style={{ background: "linear-gradient(180deg,#E8F0FA,#FFFBF2)" }}>{emoji}</div>
        }
      />
    );
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <TopBar title="Make Me a New Story" color={color} onExit={onBack} />
      <div className="px-5 pt-6">
        {!loading && (
          <>
            <p className="text-sm mb-4" style={{ color: "#8B8499" }}>What should the story be about?</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {CHIPS.map((c) => (
                <button key={c} onClick={() => generate(c)} className="kbtn px-3 py-2 rounded-full font-bold text-sm" style={{ background: "#FFFBF2", color: "#2B2250", border: "1px solid #EEE6D6" }}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && topic.trim() && generate(topic.trim())}
                placeholder="Or type your own idea..."
                className="flex-1 text-sm px-4 py-3 rounded-xl outline-none"
                style={{ border: "2px solid #EEE6D6", color: "#2B2250" }}
              />
              <button onClick={() => topic.trim() && generate(topic.trim())} disabled={!topic.trim()} className="kbtn w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: color, opacity: topic.trim() ? 1 : 0.5 }}>
                <Send size={18} color="#fff" />
              </button>
            </div>
          </>
        )}

        {loading && (
          <div className="rounded-2xl p-8 text-center" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
            <div className="text-4xl mb-3">✍️</div>
            <div className="text-sm font-bold" style={{ color: "#8B8499" }}>Writing your story...</div>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-2xl p-5 text-center" style={{ background: "#fff", border: "2px solid #D98551" }}>
            <div className="text-sm font-bold mb-3" style={{ color: "#D98551" }}>Couldn't reach the tutor — check your connection and try again.</div>
          </div>
        )}
      </div>
    </div>
  );
}

const SCENE_STICKERS = {
  ball: ["🔴", "⚽", "✨"],
  birds: ["🐦", "🦋", "☀️"],
  dog: ["🐶", "🦴", "🐾"],
  kite: ["🪁", "☁️", "🌬️"],
  garden: ["🌷", "🌻", "🦋"],
  puppy: ["🐾", "🏠", "❤️"],
  fair: ["🎡", "🎈", "🍭"],
  hills: ["🌄", "🌳", "☀️"],
  kitten: ["🐱", "🌙", "⭐"],
  treehouse: ["🌳", "🔨", "🪵"],
  garage: ["📦", "🖍️", "🏠"],
  science: ["🔬", "🌱", "📊"],
  ocean: ["🌊", "🍾", "🏝️"],
  restaurant: ["🍽️", "👨‍🍳", "⏱️"],
  school: ["📚", "✏️", "🤝"],
};

function StoryReader({ story, grade, color, onBack, onExit, illustrationOverride, extraHeaderContent }) {
  const sightSet = new Set(WORD_LISTS[grade].map((w) => w.toLowerCase()));
  // Tokenize ONCE the exact same way speakWithHighlight does, then group those
  // same tokens into sentences. This keeps highlight indices perfectly aligned —
  // splitting per-sentence separately silently drops inter-sentence whitespace
  // and makes the highlight drift further off the longer the story runs.
  const allTokens = story.text.split(/(\s+)/);
  const sentenceGroups = [];
  let currentGroup = [];
  allTokens.forEach((tok, i) => {
    currentGroup.push({ tok, idx: i });
    if (/[.!?]["')\]]?$/.test(tok.trim()) && tok.trim().length > 0) {
      sentenceGroups.push(currentGroup);
      currentGroup = [];
    }
  });
  if (currentGroup.length) sentenceGroups.push(currentGroup);
  const SENTENCE_COLORS = ["#2B2250", "#3D6E96", "#4F8A6B", "#6B5A96", "#B5643A"];
  const stickers = SCENE_STICKERS[story.scene] || ["✨"];
  const [picked, setPicked] = useState(null);
  const [checked, setChecked] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState(-1);

  const questionRef = useRef(null);
  const hasAutoPlayedRef = useRef(false);

  function readWhole() {
    speakWithHighlight(story.text, 0.85, setSpeakingIdx, () => setSpeakingIdx(-1));
  }

  function readQuestion() {
    speakSequence([story.question.prompt, ...story.question.options.map((o, i) => `Choice ${i + 1}: ${o}`)], 0.85, 400);
  }

  useEffect(() => {
    setPicked(null);
    setChecked(false);
    setSpeakingIdx(-1);
    hasAutoPlayedRef.current = false;
  }, [story.title]);

  useEffect(() => {
    const el = questionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasAutoPlayedRef.current) {
          hasAutoPlayedRef.current = true;
          readQuestion();
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [story.title]); // eslint-disable-line

  function checkAnswer() {
    if (picked === null) return;
    setChecked(true);
    if (picked === story.question.correct) speak("That's right!");
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6" style={{ borderBottom: "2px solid #EEE6D6" }}>
        <button onClick={onBack} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#2B2250", background: "#EEE6D6" }}>
          <ArrowLeft size={16} /> Stories
        </button>
        <button onClick={onExit} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#2B2250", background: "#EEE6D6" }}>
          <Home size={16} />
        </button>
      </div>

      <div className="px-5 pt-5">
        <h2 className="text-xl font-black mb-3" style={{ color: "#2B2250" }}>{story.title}</h2>

        <div className="w-full rounded-2xl overflow-hidden mb-4" style={{ height: 180, border: "2px solid #EEE6D6" }}>
          {illustrationOverride || <StoryIllustration scene={story.scene} />}
        </div>
        {extraHeaderContent}

        <button onClick={readWhole} className="kbtn w-full mb-4 rounded-xl py-3 flex items-center justify-center gap-2 font-black text-white" style={{ background: color }}>
          <Volume2 size={18} /> {speakingIdx >= 0 ? "Reading Along..." : "Read the Whole Story"}
        </button>

        <div className="rounded-2xl p-5 mb-4" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          {sentenceGroups.map((group, sIdx) => {
            const sColor = SENTENCE_COLORS[sIdx % SENTENCE_COLORS.length];
            return (
              <React.Fragment key={sIdx}>
                <div
                  className="text-lg mb-2 last:mb-0"
                  style={{ color: sColor, lineHeight: 2, letterSpacing: "0.01em", wordSpacing: "0.2em" }}
                >
                  {group.map(({ tok, idx: myIdx }, i) => {
                    const isSpeaking = myIdx === speakingIdx;
                    const clean = tok.replace(/[^a-zA-Z']/g, "").toLowerCase();
                    const isSight = sightSet.has(clean);
                    if (!clean || /^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
                    if (!isSight) {
                      return (
                        <span
                          key={i}
                          onClick={() => speak(clean)}
                          className="cursor-pointer"
                          style={{ borderBottom: "1.5px dotted #C9C2D6", background: isSpeaking ? "#FFE79A" : "transparent", borderRadius: isSpeaking ? 4 : 0, boxShadow: isSpeaking ? "0 0 0 3px #FFE79A" : "none" }}
                        >
                          {tok}
                        </span>
                      );
                    }
                    return (
                      <span
                        key={i}
                        onClick={() => speak(clean)}
                        className="font-black cursor-pointer"
                        style={{ background: isSpeaking ? "#FFE79A" : `${color}33`, color: "#2B2250", borderRadius: 4, padding: "1px 3px", boxShadow: isSpeaking ? "0 0 0 3px #FFE79A" : "none" }}
                      >
                        {tok}
                      </span>
                    );
                  })}
                </div>
                {sIdx < sentenceGroups.length - 1 && (
                  <div className="text-4xl text-center mb-3 select-none" aria-hidden="true">
                    {stickers[sIdx % stickers.length]}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        <p className="text-xs text-center mb-5" style={{ color: "#8B8499" }}>Tap any word — highlighted or not — to hear it read aloud.</p>

        <div ref={questionRef} className="rounded-2xl p-4" style={{ background: "#fff", border: `2px solid ${color}` }}>
          <div className="flex items-start gap-2 mb-3">
            <div className="font-black text-sm flex-1" style={{ color: "#2B2250" }}>{story.question.prompt}</div>
            <button
              onClick={readQuestion}
              className="kbtn w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: `${color}22`, color }}
            >
              <Volume2 size={16} />
            </button>
          </div>
          <div className="space-y-2 mb-3">
            {story.question.options.map((opt, i) => {
              const isPicked = picked === i;
              const isCorrect = i === story.question.correct;
              let bg = "#FFFBF2", border = "#EEE6D6", text = "#2B2250";
              if (checked && isPicked && isCorrect) { bg = "#6FAE8B22"; border = "#6FAE8B"; }
              else if (checked && isPicked && !isCorrect) { bg = "#D9855122"; border = "#D98551"; }
              else if (isPicked) { border = color; }
              return (
                <button
                  key={i}
                  onClick={() => { if (!checked) setPicked(i); }}
                  className="kbtn w-full text-left px-4 py-2.5 rounded-xl font-bold text-sm"
                  style={{ background: bg, border: `2px solid ${border}`, color: text }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {!checked ? (
            <button onClick={checkAnswer} disabled={picked === null} className="kbtn w-full py-2.5 rounded-xl font-black text-white" style={{ background: color, opacity: picked === null ? 0.5 : 1 }}>
              Check Answer
            </button>
          ) : (
            <div className="text-center text-sm font-bold" style={{ color: picked === story.question.correct ? "#6FAE8B" : "#D98551" }}>
              {picked === story.question.correct ? "Nice reading! That's correct." : `Good try — the answer was "${story.question.options[story.question.correct]}"`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StoryIllustration({ scene }) {
  const sky = (
    <>
      <rect width="200" height="140" fill="#E8F0FA" />
      <rect y="105" width="200" height="35" fill="#CDE6D6" />
    </>
  );

  const scenes = {
    ball: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        {sky}
        <circle cx="165" cy="28" r="16" fill="#E8B84B" opacity="0.85" />
        <circle cx="100" cy="90" r="34" fill="#D98551" />
        <circle cx="90" cy="80" r="8" fill="#fff" opacity="0.35" />
        <path d="M70 90 A30 30 0 0 1 130 90" stroke="#fff" strokeWidth="3" fill="none" opacity="0.4" />
      </svg>
    ),
    birds: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        {sky}
        <circle cx="165" cy="25" r="14" fill="#E8B84B" opacity="0.85" />
        {[[55, 40], [100, 60], [140, 35]].map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y} rx="12" ry="9" fill="#E8B84B" />
            <path d={`M${x - 12} ${y} Q${x - 20} ${y - 8} ${x - 6} ${y - 4}`} stroke="#5B9BD1" strokeWidth="4" fill="none" strokeLinecap="round" />
            <circle cx={x + 8} cy={y - 3} r="2" fill="#2B2250" />
          </g>
        ))}
      </svg>
    ),
    dog: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        {sky}
        <circle cx="165" cy="25" r="14" fill="#E8B84B" opacity="0.85" />
        <ellipse cx="100" cy="85" rx="38" ry="34" fill="#D98551" />
        <ellipse cx="75" cy="55" rx="12" ry="18" fill="#D98551" transform="rotate(-20 75 55)" />
        <ellipse cx="125" cy="55" rx="12" ry="18" fill="#D98551" transform="rotate(20 125 55)" />
        <circle cx="88" cy="80" r="4" fill="#2B2250" />
        <circle cx="112" cy="80" r="4" fill="#2B2250" />
        <ellipse cx="100" cy="95" rx="7" ry="5" fill="#2B2250" />
        <path d="M92 105 Q100 112 108 105" stroke="#2B2250" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </svg>
    ),
    kite: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        {sky}
        <ellipse cx="50" cy="30" rx="20" ry="10" fill="#fff" opacity="0.8" />
        <ellipse cx="150" cy="22" rx="16" ry="8" fill="#fff" opacity="0.8" />
        <path d="M120 30 L140 55 L120 80 L100 55 Z" fill="#8E7CC3" />
        <path d="M120 30 L120 80 M100 55 L140 55" stroke="#fff" strokeWidth="1.5" opacity="0.6" />
        <path d="M120 80 Q116 95 122 105 Q118 115 124 125" stroke="#2B2250" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    ),
    garden: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        {sky}
        <circle cx="165" cy="25" r="14" fill="#E8B84B" opacity="0.85" />
        {[40, 75, 110, 145].map((x, i) => (
          <g key={i}>
            <line x1={x} y1="115" x2={x} y2="95" stroke="#6FAE8B" strokeWidth="3" />
            <circle cx={x} cy="90" r="9" fill={["#D98551", "#8E7CC3", "#5B9BD1", "#E8B84B"][i % 4]} />
          </g>
        ))}
      </svg>
    ),
    puppy: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        {sky}
        <rect x="30" y="70" width="34" height="34" rx="4" fill="#D98551" opacity="0.5" />
        <path d="M30 70 L47 52 L64 70 Z" fill="#D98551" opacity="0.5" />
        <ellipse cx="120" cy="95" rx="30" ry="26" fill="#E8B84B" />
        <ellipse cx="103" cy="78" rx="9" ry="14" fill="#E8B84B" transform="rotate(-15 103 78)" />
        <ellipse cx="137" cy="78" rx="9" ry="14" fill="#E8B84B" transform="rotate(15 137 78)" />
        <circle cx="112" cy="92" r="3.5" fill="#2B2250" />
        <circle cx="128" cy="92" r="3.5" fill="#2B2250" />
        <ellipse cx="120" cy="102" rx="5" ry="4" fill="#2B2250" />
      </svg>
    ),
    fair: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        {sky}
        <circle cx="100" cy="60" r="38" fill="none" stroke="#5B9BD1" strokeWidth="4" />
        <circle cx="100" cy="60" r="4" fill="#2B2250" />
        {[0, 60, 120, 180, 240, 300].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          const x = 100 + 34 * Math.cos(rad);
          const y = 60 + 34 * Math.sin(rad);
          return <circle key={i} cx={x} cy={y} r="7" fill={["#D98551", "#8E7CC3", "#E8B84B"][i % 3]} />;
        })}
        <rect x="96" y="98" width="8" height="18" fill="#8B8499" />
      </svg>
    ),
    hills: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        {sky}
        <circle cx="160" cy="28" r="15" fill="#E8B84B" opacity="0.85" />
        <path d="M0 110 Q50 80 100 105 Q150 85 200 108 L200 140 L0 140 Z" fill="#8FBF9F" />
        <path d="M0 125 Q60 100 120 122 Q170 105 200 122 L200 140 L0 140 Z" fill="#6FAE8B" />
        <rect x="30" y="88" width="18" height="16" fill="#D98551" />
        <path d="M27 88 L39 76 L51 88 Z" fill="#8B5F3C" />
      </svg>
    ),
    kitten: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        <rect width="200" height="140" fill="#2B2250" />
        <circle cx="40" cy="25" r="3" fill="#E8B84B" opacity="0.8" />
        <circle cx="70" cy="15" r="2" fill="#E8B84B" opacity="0.7" />
        <circle cx="150" cy="20" r="2.5" fill="#E8B84B" opacity="0.8" />
        <circle cx="170" cy="35" r="2" fill="#E8B84B" opacity="0.6" />
        <circle cx="150" cy="45" r="20" fill="#F0F0F0" opacity="0.9" />
        <rect y="115" width="200" height="25" fill="#3A3560" />
        <ellipse cx="100" cy="100" rx="26" ry="22" fill="#8E7CC3" />
        <ellipse cx="86" cy="82" rx="8" ry="12" fill="#8E7CC3" transform="rotate(-15 86 82)" />
        <ellipse cx="114" cy="82" rx="8" ry="12" fill="#8E7CC3" transform="rotate(15 114 82)" />
        <circle cx="92" cy="98" r="3" fill="#FFFBF2" />
        <circle cx="108" cy="98" r="3" fill="#FFFBF2" />
      </svg>
    ),
    treehouse: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        {sky}
        <circle cx="168" cy="24" r="14" fill="#E8B84B" opacity="0.85" />
        <rect x="92" y="70" width="14" height="45" fill="#8B5F3C" />
        <circle cx="99" cy="52" r="34" fill="#6FAE8B" />
        <circle cx="72" cy="62" r="22" fill="#7FBF9B" />
        <circle cx="126" cy="62" r="22" fill="#5B9E7B" />
        <rect x="74" y="60" width="50" height="30" rx="3" fill="#B5804F" />
        <path d="M70 60 L99 42 L128 60 Z" fill="#8B5F3C" />
        <rect x="92" y="72" width="14" height="18" fill="#6B4A2F" />
      </svg>
    ),
    garage: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        <rect width="200" height="140" fill="#EFE9DE" />
        <rect y="112" width="200" height="28" fill="#C9BFAE" />
        <rect x="24" y="66" width="44" height="34" rx="2" fill="#D98551" />
        <path d="M24 66 L46 66 M24 78 L68 78" stroke="#B5643A" strokeWidth="2" />
        <rect x="80" y="76" width="38" height="26" rx="2" fill="#8E7CC3" />
        <rect x="128" y="60" width="46" height="42" rx="2" fill="#5B9BD1" />
        <path d="M128 74 L174 74" stroke="#3D6E96" strokeWidth="2" />
        <rect x="138" y="40" width="26" height="18" rx="2" fill="#fff" stroke="#C9C2D6" strokeWidth="1.5" />
      </svg>
    ),
    science: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        <rect width="200" height="140" fill="#EAF2F8" />
        <rect y="110" width="200" height="30" fill="#D3E2ED" />
        <path d="M74 46 L74 74 L58 108 Q56 116 64 116 L96 116 Q104 116 102 108 L86 74 L86 46 Z" fill="#B8DCEA" stroke="#5B9BD1" strokeWidth="2.5" />
        <path d="M62 100 Q80 96 98 100 L96 108 Q80 104 64 108 Z" fill="#6FAE8B" />
        <rect x="70" y="42" width="20" height="5" rx="2" fill="#5B9BD1" />
        <rect x="128" y="86" width="30" height="26" rx="3" fill="#D98551" />
        <rect x="139" y="66" width="8" height="22" fill="#6FAE8B" />
        <circle cx="143" cy="62" r="10" fill="#7FBF9B" />
      </svg>
    ),
    ocean: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        <rect width="200" height="140" fill="#DCEEF8" />
        <circle cx="164" cy="26" r="15" fill="#E8B84B" opacity="0.85" />
        <path d="M0 80 Q40 70 80 80 T160 80 T200 78 L200 140 L0 140 Z" fill="#5B9BD1" />
        <path d="M0 96 Q45 86 90 96 T180 94 L200 96 L200 140 L0 140 Z" fill="#3D6E96" />
        <rect x="88" y="70" width="16" height="30" rx="7" fill="#B8DCEA" stroke="#7FA8C4" strokeWidth="1.5" />
        <rect x="91" y="78" width="10" height="16" fill="#FFFBF2" />
        <rect x="92" y="64" width="8" height="8" rx="2" fill="#8B5F3C" />
      </svg>
    ),
    restaurant: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        <rect width="200" height="140" fill="#F5EFE6" />
        <rect y="100" width="200" height="40" fill="#D9C6AE" />
        <circle cx="100" cy="78" r="30" fill="#fff" stroke="#C9BFAE" strokeWidth="2.5" />
        <circle cx="100" cy="78" r="18" fill="#F0E6D8" />
        <rect x="48" y="62" width="4" height="32" rx="2" fill="#8B8499" />
        <path d="M44 58 L44 70 M52 58 L52 70" stroke="#8B8499" strokeWidth="3" strokeLinecap="round" />
        <path d="M150 58 L150 94" stroke="#8B8499" strokeWidth="4" strokeLinecap="round" />
        <path d="M146 58 Q150 70 154 58" stroke="#8B8499" strokeWidth="3" fill="none" />
      </svg>
    ),
    school: (
      <svg viewBox="0 0 200 140" className="w-full h-full">
        <rect width="200" height="140" fill="#EFEAE0" />
        <rect y="108" width="200" height="32" fill="#D6CDBD" />
        <rect x="30" y="46" width="66" height="50" rx="3" fill="#2B2250" />
        <rect x="38" y="54" width="50" height="34" rx="2" fill="#3D6E96" />
        <path d="M46 62 L78 62 M46 72 L70 72" stroke="#fff" strokeWidth="2" opacity="0.7" />
        <rect x="116" y="72" width="42" height="8" rx="2" fill="#D98551" />
        <rect x="116" y="82" width="42" height="8" rx="2" fill="#6FAE8B" />
        <rect x="116" y="92" width="42" height="8" rx="2" fill="#8E7CC3" />
      </svg>
    ),
  };

  return scenes[scene] || (
    <svg viewBox="0 0 200 140" className="w-full h-full">{sky}</svg>
  );
}

function JokesMode({ grade, onExit }) {
  const color = "#E8B84B";
  const [joke, setJoke] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revealed, setRevealed] = useState(false);

  async function fetchJoke() {
    setLoading(true);
    setError(false);
    setRevealed(false);
    const words = shuffle(WORD_LISTS[grade]).slice(0, 10).join(", ");
    const prompt = `Write one short, silly joke or riddle for a ${GRADE_LABEL[grade]} child learning to read. Try to use some of these words if it fits naturally: ${words}. Keep the setup and punchline each under 12 words, simple and silly. Respond ONLY with JSON, no markdown fences: {"setup": "...", "punchline": "..."}`;
    const reply = await askClaude(prompt, 250);
    const parsed = extractJson(reply);
    setLoading(false);
    if (parsed && parsed.setup && parsed.punchline) setJoke(parsed); else setError(true);
  }

  useEffect(() => { fetchJoke(); }, []); // eslint-disable-line

  function reveal() {
    setRevealed(true);
    speak(joke.punchline);
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <TopBar title="Joke Time" color={color} onExit={onExit} />
      <div className="px-5 pt-8 text-center">
        {loading && (
          <div className="rounded-3xl p-10" style={{ background: "#fff", border: `3px solid ${color}` }}>
            <div className="text-4xl mb-3">😄</div>
            <div className="text-sm font-bold" style={{ color: "#8B8499" }}>Thinking of a good one...</div>
          </div>
        )}
        {error && !loading && (
          <div className="rounded-3xl p-8" style={{ background: "#fff", border: "2px solid #D98551" }}>
            <div className="text-sm font-bold mb-3" style={{ color: "#D98551" }}>Couldn't reach the tutor — try again.</div>
            <button onClick={fetchJoke} className="kbtn px-4 py-2 rounded-xl font-black text-white" style={{ background: color }}>Try Again</button>
          </div>
        )}
        {joke && !loading && !error && (
          <>
            <div className="rounded-3xl p-8 mb-5" style={{ background: "#fff", border: `3px solid ${color}` }}>
              <button onClick={() => speak(joke.setup)} className="kbtn inline-flex items-center gap-2 mb-4 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: `${color}22`, color: "#8B6F1D" }}>
                <Volume2 size={12} /> Hear it
              </button>
              <div className="text-xl font-black mb-4" style={{ color: "#2B2250" }}>{joke.setup}</div>
              {revealed && <div className="text-lg font-bold pt-4" style={{ color: "#6FAE8B", borderTop: "2px dashed #EEE6D6" }}>{joke.punchline} 😆</div>}
            </div>
            {!revealed ? (
              <button onClick={reveal} className="kbtn w-full py-3 rounded-xl font-black text-white mb-3" style={{ background: color }}>Reveal the Answer</button>
            ) : (
              <button onClick={fetchJoke} className="kbtn w-full py-3 rounded-xl font-black text-white flex items-center justify-center gap-2 mb-3" style={{ background: color }}>
                <RefreshCw size={16} /> Another One
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SentenceBuilderMode({ grade, onExit }) {
  const color = "#5B9BD1";
  const pool = SENTENCE_POOLS[grade];
  const queueRef = useRef([]);
  const [sentence, setSentence] = useState("");
  const [wordBank, setWordBank] = useState([]);
  const [built, setBuilt] = useState([]);
  const [status, setStatus] = useState(null);
  const [round, setRound] = useState(1);
  const [drag, setDrag] = useState(null); // { item, source, x, y }
  const startPosRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const builtZoneRef = useRef(null);
  const tileRefs = useRef({});

  function loadSentence() {
    if (queueRef.current.length === 0) queueRef.current = shuffle(pool);
    const s = queueRef.current.shift();
    const words = s.split(" ").map((w, i) => ({ id: i, text: w }));
    setSentence(s);
    setWordBank(shuffle(words));
    setBuilt([]);
    setStatus(null);
  }

  useEffect(() => { loadSentence(); }, [grade]); // eslint-disable-line

  function speakTile(item) {
    speak(item.text.replace(/[^a-zA-Z']/g, ""));
  }

  function computeInsertIndex(x, excludeId) {
    const entries = built.filter((w) => w.id !== excludeId);
    for (let i = 0; i < entries.length; i++) {
      const el = tileRefs.current[entries[i].id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (x < rect.left + rect.width / 2) return i;
    }
    return entries.length;
  }

  function onTileDown(e, item, source) {
    if (status === "correct") return;
    const p = e.touches ? e.touches[0] : e;
    startPosRef.current = { x: p.clientX, y: p.clientY };
    movedRef.current = false;
    setDrag({ item, source, x: p.clientX, y: p.clientY });
  }

  useEffect(() => {
    if (!drag) return;
    function move(e) {
      e.preventDefault();
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - startPosRef.current.x;
      const dy = p.clientY - startPosRef.current.y;
      if (Math.hypot(dx, dy) > 10) movedRef.current = true;
      setDrag((d) => (d ? { ...d, x: p.clientX, y: p.clientY } : d));
    }
    function up(e) {
      const p = e.changedTouches ? e.changedTouches[0] : e;
      finishDrag(p.clientX, p.clientY);
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [drag]); // eslint-disable-line

  function finishDrag(x, y) {
    setDrag((d) => {
      if (!d) return null;
      const { item, source } = d;
      const wasTap = !movedRef.current;
      if (wasTap) {
        speakTile(item);
        return null;
      }
      const rect = builtZoneRef.current?.getBoundingClientRect();
      const inZone = rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

      if (source === "bank") {
        if (inZone) {
          const idx = computeInsertIndex(x);
          setWordBank((b) => b.filter((w) => w.id !== item.id));
          setBuilt((b) => { const next = [...b]; next.splice(idx, 0, item); return next; });
          setStatus(null);
        }
      } else {
        if (inZone) {
          const idx = computeInsertIndex(x, item.id);
          setBuilt((b) => { const next = b.filter((w) => w.id !== item.id); next.splice(idx, 0, item); return next; });
          setStatus(null);
        } else {
          setBuilt((b) => b.filter((w) => w.id !== item.id));
          setWordBank((b) => [...b, item]);
          setStatus(null);
        }
      }
      return null;
    });
  }

  function checkSentence() {
    const attempt = built.map((w) => w.text).join(" ");
    if (attempt.toLowerCase() === sentence.toLowerCase()) {
      setStatus("correct");
      speak(sentence);
    } else {
      setStatus("wrong");
    }
  }

  function nextSentence() {
    setRound((r) => r + 1);
    loadSentence();
  }

  const allPlaced = wordBank.length === 0 && built.length > 0;

  return (
    <div className="max-w-md mx-auto pb-10">
      <TopBar title={`Sentence Builder · ${GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
      <div className="px-5 pt-6">
        <div className="text-xs font-bold mb-4 text-center" style={{ color: "#8B8499" }}>Round {round}</div>

        <div
          ref={builtZoneRef}
          className="rounded-2xl p-4 mb-4 min-h-[70px] flex flex-wrap gap-2 items-center"
          style={{ background: drag && drag.source === "bank" ? `${color}11` : "#fff", border: `2.5px solid ${color}` }}
        >
          {built.length === 0 && <span className="text-xs" style={{ color: "#C9C2D6" }}>Drag words here to build the sentence</span>}
          {built.map((w) => (
            <button
              key={w.id}
              ref={(el) => { if (el) tileRefs.current[w.id] = el; }}
              onPointerDown={(e) => onTileDown(e, w, "built")}
              onTouchStart={(e) => onTileDown(e, w, "built")}
              className="kbtn px-3 py-1.5 rounded-lg font-bold text-sm text-white touch-none"
              style={{ background: color, opacity: drag && drag.item.id === w.id ? 0.25 : 1, touchAction: "none" }}
            >
              {w.text}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 justify-center mb-2">
          {wordBank.map((w) => (
            <button
              key={w.id}
              onPointerDown={(e) => onTileDown(e, w, "bank")}
              onTouchStart={(e) => onTileDown(e, w, "bank")}
              className="kbtn px-3 py-2 rounded-lg font-bold text-sm flex items-center gap-1.5 touch-none"
              style={{ background: "#EEE6D6", color: "#2B2250", opacity: drag && drag.item.id === w.id ? 0.25 : 1, touchAction: "none" }}
            >
              <Volume2 size={12} style={{ color: "#8B8499" }} /> {w.text}
            </button>
          ))}
        </div>
        <p className="text-xs text-center mb-5" style={{ color: "#8B8499" }}>Tap a word to hear it. Drag it into the box above to place it.</p>
        {status === "wrong" && (
          <div className="text-center text-sm font-bold mb-3" style={{ color: "#D98551" }}>Not quite — drag a word to fix the order and try again.</div>
        )}
        {status === "correct" && (
          <div className="text-center text-sm font-bold mb-3" style={{ color: "#6FAE8B" }}>
            <CheckCircle2 size={16} className="inline mr-1" /> Great sentence!
          </div>
        )}

        {status !== "correct" ? (
          <button onClick={checkSentence} disabled={!allPlaced} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: color, opacity: allPlaced ? 1 : 0.5 }}>
            Check Sentence
          </button>
        ) : (
          <button onClick={nextSentence} className="kbtn w-full py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: color }}>
            Next Sentence <ArrowRight size={16} />
          </button>
        )}
      </div>

      {drag && movedRef.current && (
        <div
          className="fixed px-3 py-2 rounded-lg font-bold text-sm text-white pointer-events-none"
          style={{ left: drag.x - 20, top: drag.y - 20, background: color, zIndex: 60, boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}
        >
          {drag.item.text}
        </div>
      )}
    </div>
  );
}

const WEEKLY_NOTE_KEY = "reading-app-weekly-note";

const READING_MODE_LABELS = {
  learn: "Learn Words", test: "Spelling Test", memory: "Memory Match", balloons: "Balloon Pop",
  stories: "Story Time", sentences: "Sentence Builder", needsPractice: "Needs Practice",
  smartPractice: "Smart Practice", jokes: "Joke Time",
};
const MATH_MODE_LABELS_REPORT = {
  learn: "Learn Facts", test: "Math Test", match: "Equation Match", balloons: "Balloon Pop",
  problems: "Word Problems", builder: "Equation Builder", needsPractice: "Needs Practice",
};

function StatTile({ label, value, sub, color }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
      <div className="text-lg font-black" style={{ color: color || "#2B2250" }}>{value}</div>
      <div className="text-[10px] font-bold" style={{ color: "#8B8499" }}>{label}</div>
      {sub && <div className="text-[9px] mt-0.5" style={{ color: "#C9C2D6" }}>{sub}</div>}
    </div>
  );
}

function HardestList({ missCounts, filterPrefix, accent, emptyMsg }) {
  const rows = Object.entries(missCounts)
    .filter(([k]) => k.startsWith(filterPrefix))
    .map(([k, count]) => {
      const parts = k.split(":");
      return { item: parts.slice(2).join(":"), grade: parts[1], count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  if (rows.length === 0) return <p className="text-xs" style={{ color: "#8B8499" }}>{emptyMsg}</p>;
  const max = rows[0].count;
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs font-bold w-24 shrink-0 truncate" style={{ color: "#2B2250" }}>{r.item}</span>
          <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "#EEE6D6" }}>
            <div className="h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: accent }} />
          </div>
          <span className="text-[10px] w-14 text-right" style={{ color: "#8B8499" }}>{r.count}x missed</span>
        </div>
      ))}
    </div>
  );
}

function ModeUsageList({ modeUsage, labels, accent }) {
  const used = Object.keys(labels).map((k) => ({ key: k, label: labels[k], count: modeUsage[k] || 0 }));
  const max = Math.max(1, ...used.map((u) => u.count));
  const untouched = used.filter((u) => u.count === 0);
  return (
    <div>
      <div className="space-y-1.5 mb-2">
        {used.filter((u) => u.count > 0).sort((a, b) => b.count - a.count).map((u) => (
          <div key={u.key} className="flex items-center gap-2">
            <span className="text-xs font-bold w-28 shrink-0 truncate" style={{ color: "#2B2250" }}>{u.label}</span>
            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "#EEE6D6" }}>
              <div className="h-full rounded-full" style={{ width: `${(u.count / max) * 100}%`, background: accent }} />
            </div>
            <span className="text-[10px] w-8 text-right" style={{ color: "#8B8499" }}>{u.count}</span>
          </div>
        ))}
      </div>
      {untouched.length > 0 && (
        <div className="text-[11px] pt-2" style={{ color: "#D98551", borderTop: "1px solid #EEE6D6" }}>
          <b>Never opened:</b> {untouched.map((u) => u.label).join(", ")}
        </div>
      )}
    </div>
  );
}

function BestTimeOfDay({ hourAccuracy, accent }) {
  const rows = Object.entries(hourAccuracy)
    .map(([h, v]) => ({ hour: parseInt(h, 10), ...v, pct: v.total ? Math.round((v.correct / v.total) * 100) : 0 }))
    .filter((r) => r.total >= 5)
    .sort((a, b) => a.hour - b.hour);
  if (rows.length === 0) return <p className="text-xs" style={{ color: "#8B8499" }}>Needs a few more practice sessions at different times of day before a pattern shows up.</p>;
  const best = [...rows].sort((a, b) => b.pct - a.pct)[0];
  function fmt(h) { const ampm = h < 12 ? "am" : "pm"; const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}${ampm}`; }
  return (
    <div>
      <div className="flex items-end gap-1 mb-2" style={{ height: 60 }}>
        {rows.map((r) => (
          <div key={r.hour} className="flex-1 flex flex-col items-center justify-end" style={{ height: "100%" }}>
            <div className="w-full rounded-t" style={{ height: `${Math.max(6, r.pct)}%`, background: r.hour === best.hour ? accent : "#EEE6D6" }} />
            <div className="text-[8px] mt-0.5" style={{ color: "#8B8499" }}>{fmt(r.hour)}</div>
          </div>
        ))}
      </div>
      <div className="text-xs font-bold" style={{ color: accent }}>Sharpest around {fmt(best.hour)} — {best.pct}% correct</div>
    </div>
  );
}

function ConsistencyCalendar({ dailyLog, accent }) {
  const days = [];
  const today = new Date();
  for (let i = 34; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ key, entry: dailyLog[key] });
  }
  const activeCount = days.filter((d) => d.entry && d.entry.total > 0).length;
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-2">
        {days.map((d, i) => {
          const total = d.entry ? d.entry.total : 0;
          const intensity = total === 0 ? 0 : total < 10 ? 0.35 : total < 25 ? 0.65 : 1;
          return (
            <div key={i} className="rounded-sm" title={`${d.key}: ${total} answers`}
              style={{ paddingBottom: "100%", background: intensity === 0 ? "#EEE6D6" : accent, opacity: intensity === 0 ? 0.5 : intensity }} />
          );
        })}
      </div>
      <div className="text-xs font-bold" style={{ color: "#2B2250" }}>{activeCount} active day{activeCount === 1 ? "" : "s"} in the last 5 weeks</div>
    </div>
  );
}

function TestHistoryList({ testHistory, subjectFilter, gradeLabels, accent }) {
  const rows = testHistory.filter((t) => t.subject === subjectFilter).slice(-10).reverse();
  if (rows.length === 0) return <p className="text-xs" style={{ color: "#8B8499" }}>No tests taken yet.</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((t, i) => {
        const pct = t.total ? Math.round((t.score / t.total) * 100) : 0;
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0" style={{ color: "#8B8499" }}>{t.date.slice(5)}</span>
            <span className="w-16 shrink-0 font-bold" style={{ color: "#2B2250" }}>{gradeLabels[t.grade] || t.grade}</span>
            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "#EEE6D6" }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 80 ? "#6FAE8B" : pct >= 60 ? accent : "#D98551" }} />
            </div>
            <span className="w-12 text-right font-bold" style={{ color: "#2B2250" }}>{t.score}/{t.total}</span>
          </div>
        );
      })}
    </div>
  );
}

function TrendChart({ snapshots, field, accent, label }) {
  const rows = snapshots.slice(-30);
  if (rows.length < 2) {
    return <p className="text-xs" style={{ color: "#8B8499" }}>Trends need a few more days of practice before there's anything to chart.</p>;
  }
  const values = rows.map((r) => r[field] || 0);
  const max = Math.max(...values, 1);
  const first = values[0], last = values[values.length - 1];
  const gain = last - first;
  return (
    <div>
      <div className="flex items-end gap-0.5 mb-2" style={{ height: 50 }}>
        {values.map((v, i) => (
          <div key={i} className="flex-1 rounded-t" style={{ height: `${Math.max(3, (v / max) * 100)}%`, background: accent, opacity: 0.4 + (i / values.length) * 0.6 }} />
        ))}
      </div>
      <div className="text-xs font-bold" style={{ color: gain > 0 ? "#6FAE8B" : "#8B8499" }}>
        {gain > 0 ? `+${gain} ${label} over ${rows.length} days` : `${label}: holding steady`}
      </div>
    </div>
  );
}

function printReport(title, sections) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const html = `<!DOCTYPE html><html><head><title>${title}</title><meta charset="utf-8">
<style>
body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:0 24px;color:#1c2321;line-height:1.6}
h1{font-size:22px;margin-bottom:4px}
.date{color:#6b6259;font-size:13px;margin-bottom:28px}
h2{font-size:15px;margin-top:26px;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:4px}
p,li{font-size:13px}
ul{margin:6px 0;padding-left:20px}
.note{background:#f7f5f0;padding:12px;border-left:3px solid #a8823c;font-size:13px;margin:10px 0}
@media print{body{margin:0}}
</style></head><body>
<h1>${title}</h1>
<div class="date">Generated ${new Date().toLocaleDateString()}</div>
${sections}
</body></html>`;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
  return true;
}

function ProgressReport({ progress, onExit }) {
  const [streakData, setStreakData] = useState(null);
  const [activityLog, setActivityLog] = useState([]);
  const [missedPool, setMissedPoolLocal] = useState([]);
  const [weeklyNote, setWeeklyNote] = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [patternReport, setPatternReport] = useState(null);
  const [patternLoading, setPatternLoading] = useState(false);
  const [analytics, setAnalytics] = useState(emptyAnalytics());

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STREAK_KEY);
        if (res && res.value) setStreakData(JSON.parse(res.value));
      } catch (e) {}
    })();
    (async () => {
      try {
        const res = await window.storage.get(ACTIVITY_KEY);
        if (res && res.value) setActivityLog(JSON.parse(res.value));
      } catch (e) {}
    })();
    (async () => {
      try {
        const res = await window.storage.get(MISSED_KEY);
        if (res && res.value) setMissedPoolLocal(JSON.parse(res.value));
      } catch (e) {}
    })();
    (async () => {
      try {
        const res = await window.storage.get(WEEKLY_NOTE_KEY);
        if (res && res.value) setWeeklyNote(JSON.parse(res.value));
      } catch (e) {}
    })();
    (async () => {
      const readingMastered = Object.values(progress).reduce((s, p) => s + (p.mastered ? p.mastered.length : 0), 0);
      let mathMastered = 0;
      try {
        const res = await window.storage.get(MATH_STORAGE_KEY);
        if (res && res.value) {
          const mp = JSON.parse(res.value);
          mathMastered = Object.values(mp).reduce((s, p) => s + (p.mastered ? p.mastered.length : 0), 0);
        }
      } catch (e) {}
      logSnapshot(readingMastered, mathMastered);
      const a = await loadAnalytics();
      setAnalytics({ ...a });
    })();
  }, []); // eslint-disable-line

  async function generateWeeklyNote() {
    setWeeklyLoading(true);
    const summary = Object.entries(progress).map(([g, p]) => `${GRADE_LABEL[g]}: ${p.mastered.length}/${WORD_LISTS[g].length} words mastered${p.lastTest ? `, last spelling test ${p.lastTest.score}/${p.lastTest.total}` : ""}`).join("; ");
    const streakText = streakData ? `Current streak: ${streakData.currentStreak} days.` : "";
    const prompt = `You're writing a brief, warm weekly note to a parent about their young child's reading practice this week, like a teacher's note home. Data: ${summary}. ${streakText} In 3-4 sentences: what's going well, what still needs work, and one plain, practical suggestion for the coming week. Warm but honest, no fluff, speak directly to the parent.`;
    const reply = await askClaude(prompt, 400);
    const note = { text: reply || "Couldn't generate this week's note — try again in a moment.", date: todayStr() };
    setWeeklyLoading(false);
    setWeeklyNote(note);
    try { await window.storage.set(WEEKLY_NOTE_KEY, JSON.stringify(note)); } catch (e) {}
  }

  async function generatePatternReport() {
    setPatternLoading(true);
    if (missedPool.length === 0) {
      setPatternReport("Not enough data yet — once he's missed some words across a few sessions, this will look for real patterns worth mentioning to a teacher.");
      setPatternLoading(false);
      return;
    }
    const words = missedPool.map((m) => m.word).join(", ");
    const prompt = `A parent wants a factual, non-diagnostic summary of patterns in their young child's reading mistakes, written so they can share it with a teacher or pediatrician if useful. Here are words the child has gotten wrong recently across practice sessions: ${words}. Write 3-5 sentences: describe any real, specific patterns you notice (e.g., particular sounds, endings, letter confusions) — only mention patterns that are actually supported by the words listed. Do not diagnose any condition. Plain, clear, factual language a parent could literally copy into an email to a teacher.`;
    const reply = await askClaude(prompt, 450);
    setPatternLoading(false);
    setPatternReport(reply || "Couldn't generate this right now — try again in a moment.");
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <TopBar title="Progress Report" color="#2B2250" onExit={onExit} />
      <div className="px-5 pt-6">
        {streakData && (
          <div className="rounded-2xl p-4 mb-5 flex items-center gap-4" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: "#E8B84B22" }}>
              <Flame size={22} style={{ color: "#D98551" }} />
            </div>
            <div>
              <div className="font-black text-sm" style={{ color: "#2B2250" }}>{streakData.currentStreak} day{streakData.currentStreak === 1 ? "" : "s"} in a row</div>
              <div className="text-xs" style={{ color: "#8B8499" }}>Best streak: {streakData.longestStreak} day{streakData.longestStreak === 1 ? "" : "s"}</div>
            </div>
          </div>
        )}

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #2B2250" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} style={{ color: "#2B2250" }} />
              <div className="font-black text-sm" style={{ color: "#2B2250" }}>This Week's Note</div>
            </div>
            <button onClick={generateWeeklyNote} disabled={weeklyLoading} className="kbtn text-xs font-black px-2.5 py-1 rounded-full" style={{ background: "#EEE6D6", color: "#2B2250", opacity: weeklyLoading ? 0.5 : 1 }}>
              <RefreshCw size={11} className="inline mr-1" /> {weeklyNote ? "Refresh" : "Generate"}
            </button>
          </div>
          {weeklyLoading && <div className="text-xs" style={{ color: "#8B8499" }}>Writing this week's note...</div>}
          {weeklyNote && !weeklyLoading && <p className="text-sm" style={{ color: "#2B2250" }}>{weeklyNote.text}</p>}
          {!weeklyNote && !weeklyLoading && <p className="text-xs" style={{ color: "#8B8499" }}>Tap Generate for a quick written summary of how this week went.</p>}
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #B5643A" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <FileText size={14} style={{ color: "#B5643A" }} />
              <div className="font-black text-sm" style={{ color: "#2B2250" }}>Pattern Report</div>
            </div>
            <button onClick={generatePatternReport} disabled={patternLoading} className="kbtn text-xs font-black px-2.5 py-1 rounded-full" style={{ background: "#B5643A22", color: "#B5643A", opacity: patternLoading ? 0.5 : 1 }}>
              <RefreshCw size={11} className="inline mr-1" /> {patternReport ? "Refresh" : "Generate"}
            </button>
          </div>
          {patternLoading && <div className="text-xs" style={{ color: "#8B8499" }}>Looking for patterns...</div>}
          {patternReport && !patternLoading && <p className="text-sm" style={{ color: "#2B2250" }}>{patternReport}</p>}
          {!patternReport && !patternLoading && <p className="text-xs" style={{ color: "#8B8499" }}>A factual summary of real patterns in his mistakes — shareable with a teacher or pediatrician if it's ever useful. Not a diagnosis.</p>}
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-black text-sm" style={{ color: "#2B2250" }}>Focus Timeline</div>
            <div className="text-xs font-bold" style={{ color: "#D98551" }}>{computePace(activityLog)} correct/min</div>
          </div>
          <FocusTimeline log={activityLog} activeColor="#6FAE8B" idleColor="#EEE6D6" />
        </div>

        {(() => {
          const totalSeconds = Object.values(analytics.dailyLog).reduce((s, d) => s + (d.seconds || 0), 0);
          const totalAnswers = Object.values(analytics.dailyLog).reduce((s, d) => s + (d.total || 0), 0);
          const totalCorrect = Object.values(analytics.dailyLog).reduce((s, d) => s + (d.correct || 0), 0);
          const activeDays = Object.values(analytics.dailyLog).filter((d) => d.total > 0).length;
          const acc = totalAnswers ? Math.round((totalCorrect / totalAnswers) * 100) : 0;
          return (
            <div className="grid grid-cols-4 gap-2 mb-5">
              <StatTile label="practiced" value={formatMinutes(totalSeconds)} color="#3D6E96" />
              <StatTile label="days" value={activeDays} color="#6FAE8B" />
              <StatTile label="answers" value={totalAnswers} color="#8E7CC3" />
              <StatTile label="accuracy" value={`${acc}%`} color="#D98551" />
            </div>
          );
        })()}

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#2B2250" }}>Hardest Words</div>
          <HardestList missCounts={analytics.missCounts} filterPrefix="reading:" accent="#D98551"
            emptyMsg="Nothing missed repeatedly yet — this fills in as he practices." />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#2B2250" }}>What He Actually Uses</div>
          <ModeUsageList modeUsage={analytics.modeUsage} labels={READING_MODE_LABELS} accent="#8E7CC3" />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#2B2250" }}>Best Time of Day</div>
          <BestTimeOfDay hourAccuracy={analytics.hourAccuracy} accent="#6FAE8B" />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#2B2250" }}>Practice Consistency</div>
          <ConsistencyCalendar dailyLog={analytics.dailyLog} accent="#6FAE8B" />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#2B2250" }}>Words Mastered Over Time</div>
          <TrendChart snapshots={analytics.snapshots} field="readingMastered" accent="#3D6E96" label="words" />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#2B2250" }}>Spelling Test History</div>
          <TestHistoryList testHistory={analytics.testHistory} subjectFilter="reading" gradeLabels={GRADE_LABEL} accent="#3D6E96" />
        </div>

        <button
          onClick={() => {
            const totalSeconds = Object.values(analytics.dailyLog).reduce((s, d) => s + (d.seconds || 0), 0);
            const totalAnswers = Object.values(analytics.dailyLog).reduce((s, d) => s + (d.total || 0), 0);
            const totalCorrect = Object.values(analytics.dailyLog).reduce((s, d) => s + (d.correct || 0), 0);
            const hardest = Object.entries(analytics.missCounts).filter(([k]) => k.startsWith("reading:"))
              .sort((a, b) => b[1] - a[1]).slice(0, 10)
              .map(([k, c]) => `<li>${k.split(":").slice(2).join(":")} — missed ${c} time${c === 1 ? "" : "s"}</li>`).join("");
            const perGrade = Object.keys(WORD_LISTS).map((g) =>
              `<li>${GRADE_LABEL[g]}: ${(progress[g]?.mastered || []).length} of ${WORD_LISTS[g].length} words mastered${progress[g]?.lastTest ? ` — last test ${progress[g].lastTest.score}/${progress[g].lastTest.total}` : ""}</li>`).join("");
            printReport("Reading Progress Summary", `
              <h2>Overview</h2>
              <ul>
                <li>Total practice time: ${formatMinutes(totalSeconds)}</li>
                <li>Total answers given: ${totalAnswers} (${totalAnswers ? Math.round((totalCorrect / totalAnswers) * 100) : 0}% correct)</li>
                <li>Current streak: ${streakData ? streakData.currentStreak : 0} day(s)</li>
              </ul>
              <h2>Progress by Grade Level</h2><ul>${perGrade}</ul>
              <h2>Most Frequently Missed Words</h2>
              <ul>${hardest || "<li>None recorded yet.</li>"}</ul>
              ${patternReport ? `<h2>Observed Patterns</h2><div class="note">${patternReport}</div>` : ""}
              ${weeklyNote ? `<h2>Recent Summary</h2><div class="note">${weeklyNote.text}</div>` : ""}
              <h2>Note</h2>
              <p style="font-size:12px;color:#6b6259">This summary reflects in-app practice only and is not a diagnostic assessment.</p>
            `);
          }}
          className="kbtn w-full py-3 rounded-xl font-black text-white mb-5 flex items-center justify-center gap-2"
          style={{ background: "#2B2250" }}
        >
          <FileText size={16} /> Print / Save Summary for Teacher
        </button>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="font-black text-sm mb-2" style={{ color: "#2B2250" }}>Badges</div>
          <BadgeRow badges={computeBadges(progress, streakData ? streakData.currentStreak : 0)} />
        </div>

        {Object.keys(WORD_LISTS).map((g) => {
          const total = WORD_LISTS[g].length;
          const gp = progress[g] || { mastered: [], lastTest: null };
          const mastered = gp.mastered.length;
          const lastTest = gp.lastTest;
          return (
            <div key={g} className="rounded-2xl p-4 mb-4" style={{ background: "#fff", border: `2px solid ${GRADE_COLOR[g]}` }}>
              <div className="font-black text-sm mb-2" style={{ color: GRADE_COLOR[g] }}>{GRADE_LABEL[g]}</div>
              <div className="text-xs font-bold mb-1.5" style={{ color: "#2B2250" }}>{mastered} / {total} words mastered</div>
              <div className="h-2 rounded-full mb-3 overflow-hidden" style={{ background: "#EEE6D6" }}>
                <div className="h-full rounded-full" style={{ width: `${(mastered / total) * 100}%`, background: GRADE_COLOR[g] }} />
              </div>
              {lastTest ? (
                <>
                  <div className="text-xs font-bold mb-1" style={{ color: "#8B8499" }}>
                    Last spelling test: {lastTest.score}/{lastTest.total}
                  </div>
                  {lastTest.missed && lastTest.missed.length > 0 && (
                    <div className="text-xs" style={{ color: "#8B8499" }}>
                      Words to review: {lastTest.missed.join(", ")}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs" style={{ color: "#8B8499" }}>No spelling test taken yet</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


const MATH_GRADE_LABEL = { K: "Kindergarten", "1": "1st Grade", "2": "2nd Grade", "3": "3rd Grade", "4": "4th Grade", "5": "5th Grade" };
const MATH_GRADE_COLOR = { K: "#2F4FB2", "1": "#1D7A4C", "2": "#1C2E6B", "3": "#4C6FD1", "4": "#2E9E6B", "5": "#3A2E7A" };
const OP_WORD = { "+": "plus", "-": "minus", "×": "times", "÷": "divided by" };

const FACTS = {
  K: [
    [1, "+", 1], [2, "+", 1], [1, "+", 2], [2, "+", 2], [3, "+", 1],
    [1, "+", 3], [2, "+", 3], [3, "+", 2], [4, "+", 1], [1, "+", 4],
    [5, "-", 1], [4, "-", 1], [3, "-", 1], [2, "-", 1], [5, "-", 2],
    [4, "-", 2], [5, "-", 3], [5, "-", 4], [3, "-", 2], [4, "-", 3],
  ],
  "1": [
    [6, "+", 3], [7, "+", 4], [8, "+", 5], [9, "+", 6], [7, "+", 7],
    [8, "+", 8], [9, "+", 9], [10, "+", 5], [10, "+", 8], [9, "+", 2],
    [12, "-", 4], [15, "-", 7], [18, "-", 9], [16, "-", 8], [14, "-", 6],
    [13, "-", 5], [11, "-", 3], [6, "+", 6], [5, "+", 9], [10, "+", 10],
  ],
  "2": [
    [23, "+", 15], [47, "+", 26], [58, "+", 34], [64, "-", 28], [81, "-", 47],
    [90, "-", 55], [35, "+", 29], [72, "-", 38], [46, "+", 18], [2, "×", 3],
    [2, "×", 5], [2, "×", 7], [5, "×", 2], [5, "×", 4], [5, "×", 6],
    [10, "×", 3], [10, "×", 5], [10, "×", 7], [3, "×", 3], [4, "×", 5],
  ],
  "3": [
    [3, "×", 4], [3, "×", 6], [3, "×", 8], [4, "×", 4], [4, "×", 7],
    [6, "×", 6], [6, "×", 8], [7, "×", 7], [7, "×", 8], [8, "×", 9],
    [9, "×", 6], [9, "×", 9], [12, "÷", 3], [24, "÷", 4], [35, "÷", 5],
    [42, "÷", 6], [56, "÷", 7], [64, "÷", 8], [81, "÷", 9], [48, "÷", 6],
  ],
  "4": [
    [12, "×", 8], [15, "×", 6], [23, "×", 4], [34, "×", 5], [46, "×", 3],
    [125, "+", 268], [347, "+", 195], [512, "-", 278], [803, "-", 456], [640, "-", 385],
    [144, "÷", 12], [96, "÷", 8], [132, "÷", 11], [108, "÷", 9], [175, "÷", 7],
    [11, "×", 11], [12, "×", 12], [25, "×", 4], [50, "×", 6], [200, "÷", 8],
  ],
  "5": [
    [234, "×", 6], [156, "×", 8], [47, "×", 23], [62, "×", 34], [125, "×", 12],
    [1250, "+", 3478], [5643, "-", 2879], [4096, "÷", 8], [1728, "÷", 12], [2400, "÷", 16],
    [375, "×", 4], [625, "×", 8], [936, "÷", 12], [1440, "÷", 15], [847, "-", 398],
    [15, "×", 15], [20, "×", 25], [3000, "÷", 25], [1024, "÷", 32], [72, "×", 45],
  ],
};

function computeAnswer(a, op, b) {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "÷") return a / b;
  return a * b;
}
function factList(grade) {
  return FACTS[grade].map(([a, op, b], i) => ({ id: i, a, op, b, answer: computeAnswer(a, op, b) }));
}
function factDisplay(f) { return `${f.a} ${f.op} ${f.b}`; }
function factSpeech(f) { return `${f.a} ${OP_WORD[f.op]} ${f.b}`; }

const WORD_PROBLEMS = {
  K: [
    { title: "The Apple Tree", scene: "apples", text: "I see 2 red apples on the tree. I see 3 more apples on the ground. How many apples do I see in all?", question: { prompt: "How many apples in all?", options: [4, 5, 6], correct: 1 } },
    { title: "Ducks at the Pond", scene: "ducks", text: "There are 4 ducks swimming in the pond. 1 duck flies away. How many ducks are left?", question: { prompt: "How many ducks are left?", options: [2, 3, 4], correct: 1 } },
    { title: "Counting Stars", scene: "stars", text: "I count 3 stars in the sky. Then I count 2 more stars. How many stars did I count?", question: { prompt: "How many stars in all?", options: [4, 5, 6], correct: 1 } },
  ],
  "1": [
    { title: "The Toy Box", scene: "cars", text: "Sam has 8 toy cars. His friend gives him 5 more. How many toy cars does Sam have now?", question: { prompt: "How many toy cars now?", options: [12, 13, 14], correct: 1 } },
    { title: "The Cookie Jar", scene: "cookies", text: "There were 15 cookies in the jar. We ate 7 of them. How many cookies are left?", question: { prompt: "How many cookies are left?", options: [7, 8, 9], correct: 1 } },
    { title: "The Marble Bag", scene: "marbles", text: "Mia has 9 blue marbles and 6 red marbles. How many marbles does she have altogether?", question: { prompt: "How many marbles in all?", options: [14, 15, 16], correct: 1 } },
  ],
  "2": [
    { title: "The Bake Sale", scene: "cupcakes", text: "We sold 23 cupcakes in the morning and 15 more in the afternoon. How many cupcakes did we sell in all?", question: { prompt: "How many cupcakes sold in all?", options: [36, 38, 40], correct: 1 } },
    { title: "Sharing Stickers", scene: "stickers", text: "Each friend gets 5 stickers. There are 4 friends. How many stickers are needed in all?", question: { prompt: "How many stickers in all?", options: [18, 20, 22], correct: 1 } },
    { title: "The Long Walk", scene: "walk", text: "We walked 64 steps to the park. Then we walked 28 more steps to the store. How many steps did we walk altogether?", question: { prompt: "How many steps in all?", options: [90, 92, 94], correct: 1 } },
  ],
  "3": [
    { title: "The Book Shelves", scene: "books", text: "The library has 7 shelves. Each shelf holds 8 books. How many books are there in all?", question: { prompt: "How many books in all?", options: [54, 56, 58], correct: 1 } },
    { title: "Splitting the Team", scene: "team", text: "There are 42 students signing up for teams. The coach wants 6 equal teams. How many students go on each team?", question: { prompt: "How many students per team?", options: [6, 7, 8], correct: 1 } },
    { title: "The Garden Rows", scene: "garden2", text: "Grandma planted 9 rows of tomatoes with 6 plants in each row. How many tomato plants did she plant?", question: { prompt: "How many plants in all?", options: [52, 54, 56], correct: 1 } },
  ],
  "4": [
    { title: "The Fundraiser", scene: "money", text: "The school sold 34 tickets at 5 dollars each. How much money did they raise in all?", question: { prompt: "How much money raised?", options: [160, 170, 180], correct: 1 } },
    { title: "Packing Boxes", scene: "boxes", text: "A factory has 144 toys to pack. Each box holds 12 toys. How many boxes will they need?", question: { prompt: "How many boxes?", options: [11, 12, 13], correct: 1 } },
    { title: "The Road Trip", scene: "roadtrip", text: "We drove 347 miles on Saturday and 195 miles on Sunday. How many miles did we drive in total?", question: { prompt: "How many miles total?", options: [532, 542, 552], correct: 1 } },
  ],
  "5": [
    { title: "The Warehouse", scene: "boxes", text: "A warehouse received 4096 items to sort into 8 equal sections. How many items go in each section?", question: { prompt: "How many items per section?", options: [502, 512, 522], correct: 1 } },
    { title: "The Concert", scene: "money", text: "A concert sold 47 tickets in one hour at 23 dollars each. How much money was collected that hour?", question: { prompt: "How much money collected?", options: [1071, 1081, 1091], correct: 1 } },
    { title: "The Marathon", scene: "roadtrip", text: "A runner tracked 5643 steps in the morning, then lost 2879 steps of progress backtracking. How many steps of progress remained?", question: { prompt: "How many steps remained?", options: [2754, 2764, 2774], correct: 1 } },
  ],
};

const EQUATION_POOLS = {
  K: [
    { a: 2, op: "+", b: 3, answer: 5 },
    { a: 4, op: "-", b: 1, answer: 3 },
    { a: 1, op: "+", b: 4, answer: 5 },
    { a: 5, op: "-", b: 2, answer: 3 },
    { a: 3, op: "+", b: 2, answer: 5 },
    { a: 4, op: "-", b: 2, answer: 2 },
  ],
  "1": [
    { a: 8, op: "+", b: 5, answer: 13 },
    { a: 15, op: "-", b: 7, answer: 8 },
    { a: 9, op: "+", b: 6, answer: 15 },
    { a: 16, op: "-", b: 8, answer: 8 },
    { a: 7, op: "+", b: 7, answer: 14 },
    { a: 12, op: "-", b: 4, answer: 8 },
  ],
  "2": [
    { a: 23, op: "+", b: 15, answer: 38 },
    { a: 64, op: "-", b: 28, answer: 36 },
    { a: 5, op: "×", b: 4, answer: 20 },
    { a: 46, op: "+", b: 18, answer: 64 },
    { a: 10, op: "×", b: 3, answer: 30 },
    { a: 81, op: "-", b: 47, answer: 34 },
  ],
  "3": [
    { a: 7, op: "×", b: 8, answer: 56 },
    { a: 42, op: "÷", b: 6, answer: 7 },
    { a: 9, op: "×", b: 6, answer: 54 },
    { a: 64, op: "÷", b: 8, answer: 8 },
    { a: 6, op: "×", b: 6, answer: 36 },
    { a: 35, op: "÷", b: 5, answer: 7 },
  ],
  "4": [
    { a: 12, op: "×", b: 8, answer: 96 },
    { a: 144, op: "÷", b: 12, answer: 12 },
    { a: 23, op: "×", b: 4, answer: 92 },
    { a: 347, op: "+", b: 195, answer: 542 },
    { a: 512, op: "-", b: 278, answer: 234 },
    { a: 175, op: "÷", b: 7, answer: 25 },
  ],
  "5": [
    { a: 234, op: "×", b: 6, answer: 1404 },
    { a: 4096, op: "÷", b: 8, answer: 512 },
    { a: 47, op: "×", b: 23, answer: 1081 },
    { a: 5643, op: "-", b: 2879, answer: 2764 },
    { a: 1728, op: "÷", b: 12, answer: 144 },
    { a: 1250, op: "+", b: 3478, answer: 4728 },
  ],
};

function mathShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let mathSelectedVoiceURI = null;
let mathCachedVoices = [];
function mathRefreshVoices() {
  if (!window.speechSynthesis) return [];
  mathCachedVoices = window.speechSynthesis.getVoices() || [];
  return mathCachedVoices;
}
const MATH_VOICE_PRIORITY = ["daniel", "moira", "samantha", "karen", "tessa", "google us english", "google uk english female", "aria", "jenny", "natural"];
const MATH_AVOID_HINTS = ["compact", "novelty", "whisper", "bells", "bad news", "bubbles", "cellos", "organ", "trinoids", "zarvox", "boing"];
function mathAutoPickVoice() {
  const voices = mathRefreshVoices();
  const english = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
  const pool = english.length ? english : voices;
  const clean = pool.filter((v) => !MATH_AVOID_HINTS.some((h) => v.name.toLowerCase().includes(h)));
  for (const hint of MATH_VOICE_PRIORITY) {
    const match = clean.find((v) => v.name.toLowerCase().includes(hint));
    if (match) return match.voiceURI;
  }
  const local = clean.find((v) => v.localService);
  return (local || clean[0] || pool[0] || null)?.voiceURI || null;
}
function mathSetVoice(uri) { mathSelectedVoiceURI = uri; }
function mathGetVoiceList() { return mathRefreshVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("en")); }
function mathGetActiveVoice() {
  const voices = mathCachedVoices.length ? mathCachedVoices : mathRefreshVoices();
  const uri = mathSelectedVoiceURI || mathAutoPickVoice();
  return voices.find((v) => v.voiceURI === uri) || null;
}
function mathSpeak(text, rate = 0.85) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = 1.0;
    const v = mathGetActiveVoice();
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }, 60);
}
function mathSpeakSequence(parts, rate = 0.8, gapMs = 450) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const v = mathGetActiveVoice();
  let i = 0;
  function playNext() {
    if (i >= parts.length) return;
    const u = new SpeechSynthesisUtterance(parts[i]);
    u.rate = rate;
    u.pitch = 1.0;
    if (v) u.voice = v;
    u.onend = () => { i += 1; setTimeout(playNext, gapMs); };
    window.speechSynthesis.speak(u);
  }
  setTimeout(playNext, 60);
}

const MATH_STORAGE_KEY = "math-app-progress";
const MATH_MISSED_KEY = "math-app-missed";
const MATH_ACTIVITY_KEY = "math-app-activity";
const MATH_LAST_ACTIVITY_KEY = "math-app-last-activity";
const MATH_STREAK_KEY = "combined-app-streak";
const MATH_SPURTS_KEY = "combined-app-spurts";
const mathEmptyProgress = () => ({ K: { mastered: [], lastTest: null }, "1": { mastered: [], lastTest: null }, "2": { mastered: [], lastTest: null }, "3": { mastered: [], lastTest: null }, "4": { mastered: [], lastTest: null }, "5": { mastered: [], lastTest: null } });

function mathTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mathDaysBetween(a, b) {
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  return Math.round((d2 - d1) / 86400000);
}

const MATH_STRETCHES = [
  "Stand up tall and reach both arms to the sky. Hold for 5 seconds.",
  "Touch your toes slowly, then roll back up.",
  "Give yourself a big hug and twist gently side to side.",
  "Shake out your hands and wiggle your fingers.",
];

function MathSection({ onSwitchSubject }) {
  const [screen, setScreen] = useState("home");
  const [grade, setGrade] = useState("K");
  const [progress, setProgress] = useState(mathEmptyProgress());
  const [loaded, setLoaded] = useState(false);
  const [sessionMinutes, setSessionMinutes] = useState(15);
  const [onBreak, setOnBreak] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(sessionMinutes * 60);
  const [missedPool, setMissedPool] = useState([]);
  const [lastActivity, setLastActivity] = useState(null);
  const [learnIndex, setLearnIndex] = useState({ K: 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 });
  const [streak, setStreak] = useState(0);
  const [spurts, setSpurts] = useState(0);
  const SPURT_TARGET = 4;

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(MATH_STORAGE_KEY);
        if (res && res.value) {
          const saved = JSON.parse(res.value);
          setProgress({ ...mathEmptyProgress(), ...saved });
        }
      } catch (e) {}
      setLoaded(true);
    })();
    (async () => {
      try {
        const res = await window.storage.get(MATH_MISSED_KEY);
        if (res && res.value) setMissedPool(JSON.parse(res.value));
      } catch (e) {}
    })();
    (async () => {
      try {
        const res = await window.storage.get(MATH_LAST_ACTIVITY_KEY);
        if (res && res.value) setLastActivity(JSON.parse(res.value));
      } catch (e) {}
    })();
    (async () => {
      let data = { lastActiveDate: null, currentStreak: 0, longestStreak: 0 };
      try {
        const res = await window.storage.get(MATH_STREAK_KEY);
        if (res && res.value) data = JSON.parse(res.value);
      } catch (e) {}
      const today = mathTodayStr();
      if (data.lastActiveDate === today) {
        // already counted
      } else if (data.lastActiveDate && mathDaysBetween(data.lastActiveDate, today) === 1) {
        data.currentStreak += 1;
        data.lastActiveDate = today;
      } else {
        data.currentStreak = 1;
        data.lastActiveDate = today;
      }
      data.longestStreak = Math.max(data.longestStreak || 0, data.currentStreak);
      setStreak(data.currentStreak);
      try { await window.storage.set(MATH_STREAK_KEY, JSON.stringify(data)); } catch (e) {}
    })();
    (async () => {
      let sData = { date: mathTodayStr(), count: 0 };
      try {
        const res = await window.storage.get(MATH_SPURTS_KEY);
        if (res && res.value) sData = JSON.parse(res.value);
      } catch (e) {}
      if (sData.date !== mathTodayStr()) sData = { date: mathTodayStr(), count: 0 };
      setSpurts(sData.count);
    })();
    if (window.speechSynthesis) {
      mathRefreshVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        mathRefreshVoices();
        if (!mathSelectedVoiceURI) mathSetVoice(mathAutoPickVoice());
      };
      setTimeout(() => { if (!mathSelectedVoiceURI) mathSetVoice(mathAutoPickVoice()); }, 300);
    }
    const keepAlive = setInterval(() => {
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 4000);
    return () => clearInterval(keepAlive);
  }, []);

  useEffect(() => {
    if (screen === "home") setSecondsLeft(sessionMinutes * 60);
  }, [sessionMinutes]); // eslint-disable-line

  useEffect(() => {
    if (screen === "home" || onBreak) return;
    // Batch time into storage every 15s rather than every tick.
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      if (ticks % 15 === 0) logSeconds(15);
      setSecondsLeft((s) => {
        if (s <= 1) {
          setOnBreak(true);
          return sessionMinutes * 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (ticks % 15 !== 0) logSeconds(ticks % 15); clearInterval(id); };
  }, [screen, onBreak, sessionMinutes]);

  const saveProgress = useCallback(async (next) => {
    setProgress(next);
    try { await window.storage.set(MATH_STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
  }, []);

  const markMastered = useCallback((g, factId) => {
    setProgress((prev) => {
      const cur = prev[g]?.mastered || [];
      if (cur.includes(factId)) return prev;
      const next = { ...prev, [g]: { ...prev[g], mastered: [...cur, factId] } };
      saveProgress(next);
      return next;
    });
  }, [saveProgress]);

  const recordTest = useCallback((g, result) => {
    logTest("math", g, result.score, result.total);
    setProgress((prev) => {
      const next = { ...prev, [g]: { ...prev[g], lastTest: result } };
      saveProgress(next);
      return next;
    });
    if (result.missed && result.missed.length) {
      const facts = factList(g);
      const ids = result.missed
        .map((disp) => { const match = facts.find((f) => factDisplay(f) === disp); return match ? match.id : null; })
        .filter((id) => id !== null);
      if (ids.length) addMisses(g, ids);
    }
  }, [saveProgress]); // eslint-disable-line

  const saveMissedPool = useCallback(async (next) => {
    setMissedPool(next);
    try { await window.storage.set(MATH_MISSED_KEY, JSON.stringify(next)); } catch (e) {}
  }, []);

  function addMisses(g, factIds) {
    const facts = factList(g);
    factIds.forEach((id) => {
      const f = facts.find((x) => x.id === id);
      if (f) logMiss("math", g, factDisplay(f));
    });
    setMissedPool((prev) => {
      const existingKeys = new Set(prev.map((m) => `${m.grade}:${m.factId}`));
      const additions = factIds.filter((id) => !existingKeys.has(`${g}:${id}`)).map((id) => ({ grade: g, factId: id }));
      if (additions.length === 0) return prev;
      const next = [...prev, ...additions];
      saveMissedPool(next);
      return next;
    });
  }
  function addMiss(g, factId) { addMisses(g, [factId]); }
  function removeMiss(g, factId) {
    setMissedPool((prev) => {
      const next = prev.filter((m) => !(m.grade === g && m.factId === factId));
      saveMissedPool(next);
      return next;
    });
  }

  async function updateLastActivity(nextScreen, nextGrade) {
    if (nextScreen === "home" || nextScreen === "report" || nextScreen === "needsPractice") return;
    const data = { screen: nextScreen, grade: nextGrade };
    setLastActivity(data);
    try { await window.storage.set(MATH_LAST_ACTIVITY_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function goHome() { setScreen("home"); }

  useEffect(() => {
    if (!loaded) return;
    updateLastActivity(screen, grade);
    logModeOpen(screen);
  }, [screen, grade, loaded]); // eslint-disable-line

  async function saveSpurts(n) {
    const clamped = Math.max(0, Math.min(SPURT_TARGET, n));
    setSpurts(clamped);
    try { await window.storage.set(MATH_SPURTS_KEY, JSON.stringify({ date: mathTodayStr(), count: clamped })); } catch (e) {}
  }

  if (!loaded) {
    return (
      <div style={{ background: "#F5F8FC", minHeight: "100vh" }} className="flex items-center justify-center">
        <div style={{ color: "#1B2430" }} className="font-bold">Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ background: "#F5F8FC", minHeight: "100vh", fontFamily: "'Trebuchet MS', 'Verdana', sans-serif" }} className="relative">
      <style>{`
        @keyframes popIn { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
        @keyframes breathe { 0%, 100% { transform: scale(0.75); } 50% { transform: scale(1.15); } }
        .pop { animation: popIn 220ms ease-out; }
        .shakeIt { animation: shake 300ms ease-in-out; }
        .kbtn { transition: transform 100ms ease; }
        .kbtn:active { transform: scale(0.95); }
      `}</style>

      {screen === "home" && (
        <MathHomeScreen grade={grade} setGrade={setGrade} setScreen={setScreen} progress={progress} sessionMinutes={sessionMinutes} setSessionMinutes={setSessionMinutes} streak={streak} spurts={spurts} spurtTarget={SPURT_TARGET} setSpurts={saveSpurts} onSwitchSubject={onSwitchSubject} missedCount={missedPool.length} lastActivity={lastActivity} />
      )}
      {screen === "learn" && (
        <LearnFactsMode grade={grade} onExit={goHome} onMaster={markMastered} onMiss={addMiss} idx={learnIndex[grade]} setIdx={(i) => setLearnIndex((prev) => ({ ...prev, [grade]: i }))} />
      )}
      {screen === "test" && <MathTestMode grade={grade} onExit={goHome} onFinish={(r) => recordTest(grade, r)} />}
      {screen === "match" && <EquationMatchMode grade={grade} onExit={goHome} />}
      {screen === "balloons" && <BalloonPopMathMode grade={grade} onExit={goHome} />}
      {screen === "problems" && <WordProblemsMode grade={grade} onExit={goHome} />}
      {screen === "builder" && <EquationBuilderMode grade={grade} onExit={goHome} />}
      {screen === "report" && <MathProgressReport progress={progress} onExit={goHome} />}
      {screen === "needsPractice" && <MathNeedsPracticeMode pool={missedPool} onMaster={markMastered} onSolved={removeMiss} onExit={goHome} />}

      {screen !== "home" && !onBreak && (
        <div className="fixed top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black" style={{ background: "#1B2430", color: "#fff", zIndex: 45 }}>
          <Clock size={12} /> {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </div>
      )}

      {onBreak && <MathBreakOverlay onDone={() => { setOnBreak(false); saveSpurts(spurts + 1); }} />}
    </div>
  );
}

function MathBreakOverlay({ onDone }) {
  const DURATION = 360;
  const [secondsLeft, setSecondsLeft] = useState(DURATION);
  const [stretchIdx] = useState(() => Math.floor(Math.random() * MATH_STRETCHES.length));

  useEffect(() => {
    mathSpeak("Great work! Time for a brain break.");
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const canContinue = secondsLeft <= 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center px-6 py-8" style={{ background: "#1B2430", minHeight: "100dvh" }}>
      <div className="max-w-sm w-full text-center text-white my-auto">
        <Coffee size={36} className="mx-auto mb-3" style={{ color: "#2E9E6B" }} />
        <h2 className="text-2xl font-black mb-2">Brain Break!</h2>
        <p className="text-sm opacity-80 mb-6">Great focus so far. Let's recharge before the next round.</p>

        <div className="mx-auto mb-6 rounded-full flex items-center justify-center" style={{ width: 110, height: 110, background: "#2E9E6B22", animation: "breathe 4s ease-in-out infinite" }}>
          <Wind size={36} style={{ color: "#2E9E6B" }} />
        </div>

        <div className="rounded-2xl p-4 mb-4 text-left" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: "#2E9E6B" }}>Stretch</div>
          <p className="text-sm">{MATH_STRETCHES[stretchIdx]}</p>
        </div>

        <div className="rounded-2xl p-4 mb-6 text-left" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: "#2E9E6B" }}>Breathe</div>
          <p className="text-sm">Close your eyes. Breathe in slow for 4 counts, out for 4 counts. Some soft music can help here.</p>
        </div>

        <div className="text-3xl font-black mb-4" style={{ color: "#2E9E6B" }}>
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </div>

        <button
          onClick={onDone}
          disabled={!canContinue}
          className="kbtn w-full py-3 rounded-xl font-black"
          style={{ background: canContinue ? "#2E9E6B" : "rgba(255,255,255,0.15)", color: canContinue ? "#1B2430" : "rgba(255,255,255,0.5)" }}
        >
          {canContinue ? "Back to Learning" : "Resting a bit longer..."}
        </button>
      </div>
    </div>
  );
}

function MathTopBar({ title, color, onExit }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 sm:px-6" style={{ borderBottom: "2px solid #C0392B" }}>
      <button onClick={onExit} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#1B2430", background: "#E7ECFA" }}>
        <Home size={16} /> Home
      </button>
      <div className="font-black text-base sm:text-lg text-center px-2" style={{ color }}>{title}</div>
      <div style={{ width: 76 }} />
    </div>
  );
}

function MathVoicePicker() {
  const [voices, setVoices] = useState([]);
  const [current, setCurrent] = useState(mathSelectedVoiceURI);

  useEffect(() => {
    function load() {
      const list = mathGetVoiceList();
      setVoices(list);
      if (!current && list.length) setCurrent(mathAutoPickVoice());
    }
    load();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
  }, []); // eslint-disable-line

  function choose(uri) {
    setCurrent(uri);
    mathSetVoice(uri);
    mathSpeak("Hi! This is how I'll sound when we practice.");
  }

  if (!voices.length) return null;

  return (
    <div className="rounded-2xl p-4 mb-6" style={{ background: "#fff", border: "2px solid #C0392B" }}>
      <div className="font-black text-sm mb-2" style={{ color: "#1B2430" }}>Reading voice</div>
      <select
        value={current || ""}
        onChange={(e) => choose(e.target.value)}
        className="w-full text-sm font-bold py-2.5 px-3 rounded-xl outline-none mb-2"
        style={{ border: "2px solid #C0392B", color: "#1B2430", background: "#F5F8FC" }}
      >
        {voices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
        ))}
      </select>
      <button onClick={() => choose(current)} className="kbtn text-xs font-bold px-3 py-1.5 rounded-full" style={{ background: "#E7ECFA", color: "#5B6B7A", border: "1px solid #C0392B" }}>
        <Volume2 size={12} className="inline mr-1" /> Test this voice
      </button>
    </div>
  );
}

const MATH_SCREEN_LABELS = {
  learn: "Learn Facts", test: "Math Test",
  match: "Equation Match", balloons: "Balloon Pop", problems: "Word Problems", builder: "Equation Builder",
};

function MathHomeScreen({ grade, setGrade, setScreen, progress, sessionMinutes, setSessionMinutes, streak, spurts, spurtTarget, setSpurts, onSwitchSubject, missedCount, lastActivity }) {
  const total = FACTS[grade].length;
  const gp = progress[grade] || { mastered: [], lastTest: null };
  const mastered = gp.mastered.length;
  const lastTest = gp.lastTest;

  return (
    <div className="max-w-md mx-auto px-5 pt-8 pb-10">
      <div className="flex items-center justify-between mb-4">
        {streak > 0 ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black" style={{ background: "#2E9E6B22", color: "#1D7A4C" }}>
            <Flame size={14} /> {streak} day{streak === 1 ? "" : "s"} in a row
          </div>
        ) : <div />}
        <div className="flex items-center gap-2">
          <button onClick={onSwitchSubject} className="kbtn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black" style={{ background: "#E7ECFA", color: "#1B2430" }}>
            <ArrowLeftRight size={14} /> Reading
          </button>
          <button onClick={() => setScreen("report")} className="kbtn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black" style={{ background: "#E7ECFA", color: "#1B2430" }}>
            <BarChart3 size={14} /> Progress
          </button>
        </div>
      </div>

      {lastActivity && MATH_SCREEN_LABELS[lastActivity.screen] && (
        <button onClick={() => { setGrade(lastActivity.grade); setScreen(lastActivity.screen); }} className="kbtn w-full rounded-2xl p-4 mb-4 flex items-center gap-3 text-left" style={{ background: "#1B2430" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
            <ArrowRight size={18} color="#fff" />
          </div>
          <div className="flex-1">
            <div className="text-white font-black text-sm">Continue: {MATH_SCREEN_LABELS[lastActivity.screen]}</div>
            <div className="text-xs" style={{ color: "#B8C4E0" }}>{MATH_GRADE_LABEL[lastActivity.grade]} — pick up where you left off</div>
          </div>
        </button>
      )}

      {(() => {
        const modeKeys = Object.keys(MATH_SCREEN_LABELS);
        const featuredMode = pickWeeklyMode(modeKeys, 2);
        const focusFacts = pickWeeklyFocus(factList(grade), 6, 3);
        return (
          <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #1D7A4C" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-black text-sm" style={{ color: "#1B2430" }}>This Week's Lesson</div>
              <button
                onClick={() => mathSpeakSequence(["This week we're focusing on these facts:", ...focusFacts.map((f) => factSpeech(f)), `Let's practice with ${MATH_SCREEN_LABELS[featuredMode]}!`], 0.85, 350)}
                className="kbtn w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "#1D7A4C22", color: "#1D7A4C" }}
              >
                <Volume2 size={14} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {focusFacts.map((f) => (
                <span key={f.id} className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "#F5F8FC", color: "#1B2430", border: "1px solid #E7ECFA" }}>{factDisplay(f)}</span>
              ))}
            </div>
            <button onClick={() => setScreen(featuredMode)} className="kbtn w-full py-2.5 rounded-xl font-black text-white text-sm" style={{ background: "#1D7A4C" }}>
              Start {MATH_SCREEN_LABELS[featuredMode]}
            </button>
          </div>
        );
      })()}

      <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #C0392B" }}>
        <div className="flex items-center justify-between mb-2.5">
          <div className="font-black text-sm" style={{ color: "#1B2430" }}>Today's Learning Spurts</div>
          <div className="text-xs font-bold" style={{ color: "#5B6B7A" }}>{spurts} of {spurtTarget}</div>
        </div>
        <div className="flex gap-2">
          {Array.from({ length: spurtTarget }).map((_, i) => {
            const filled = i < spurts;
            return (
              <button
                key={i}
                onClick={() => setSpurts(filled && i === spurts - 1 ? spurts - 1 : i + 1)}
                className="kbtn flex-1 h-10 rounded-xl flex items-center justify-center font-black text-sm"
                style={{ background: filled ? "#6FAE8B" : "#E7ECFA", color: filled ? "#fff" : "#5B6B7A" }}
              >
                {filled ? <CheckCircle2 size={18} /> : i + 1}
              </button>
            );
          })}
        </div>
        {spurts >= spurtTarget && (
          <div className="text-center text-xs font-bold mt-2.5" style={{ color: "#6FAE8B" }}>All done for today — great work!</div>
        )}
      </div>

      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3" style={{ background: "#2F4FB2" }}>
          <Calculator color="#fff" size={28} />
        </div>
        <h1 className="text-2xl font-black" style={{ color: "#1B2430" }}>Number Adventure</h1>
        <p className="text-sm mt-1" style={{ color: "#5B6B7A" }}>Pick a grade, then choose what to practice</p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {Object.keys(MATH_GRADE_LABEL).map((g) => (
          <button key={g} onClick={() => setGrade(g)} className="kbtn py-3 rounded-xl font-black text-sm"
            style={{ background: grade === g ? MATH_GRADE_COLOR[g] : "#E7ECFA", color: grade === g ? "#fff" : "#1B2430" }}>
            {g === "K" ? "Kinder" : `${g}${g === "1" ? "st" : g === "2" ? "nd" : g === "3" ? "rd" : "th"}`}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-6 text-xs">
        <span className="font-bold" style={{ color: "#5B6B7A" }}>Practice session length:</span>
        {[5, 10, 15].map((m) => (
          <button key={m} onClick={() => setSessionMinutes(m)} className="kbtn px-3 py-1.5 rounded-full font-black"
            style={{ background: sessionMinutes === m ? "#1B2430" : "#E7ECFA", color: sessionMinutes === m ? "#fff" : "#1B2430" }}>
            {m} min
          </button>
        ))}
      </div>

      <MathVoicePicker />

      <div className="rounded-2xl p-4 mb-6 flex items-center gap-3" style={{ background: "#fff", border: "2px solid #C0392B" }}>
        <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: `${MATH_GRADE_COLOR[grade]}22` }}>
          <Star size={22} style={{ color: MATH_GRADE_COLOR[grade] }} fill={MATH_GRADE_COLOR[grade]} />
        </div>
        <div className="flex-1">
          <div className="font-black text-sm" style={{ color: "#1B2430" }}>{mastered} / {total} facts mastered</div>
          <div className="h-2 rounded-full mt-1.5 overflow-hidden" style={{ background: "#E7ECFA" }}>
            <div className="h-full rounded-full" style={{ width: `${(mastered / total) * 100}%`, background: MATH_GRADE_COLOR[grade], transition: "width 400ms" }} />
          </div>
        </div>
      </div>

      {lastTest && (
        <div className="rounded-xl p-3 mb-6 flex items-center gap-2 text-sm font-bold" style={{ background: "#6FAE8B22", color: "#1B2430" }}>
          <Trophy size={16} style={{ color: "#6FAE8B" }} />
          Last math test: {lastTest.score}/{lastTest.total} correct
        </div>
      )}

      <div className="space-y-3">
        <MathModeButton icon={<Volume2 size={20} />} title="Learn Facts" subtitle="See it, hear it, solve it" color="#2F4FB2" onClick={() => setScreen("learn")} />
        <MathModeButton icon={<LayoutGrid size={20} />} title="Equation Match" subtitle="Flip cards to match problems to answers" color="#4C6FD1" onClick={() => setScreen("match")} />
        <MathModeButton icon={<Sparkles size={20} />} title="Balloon Pop" subtitle="Pop the balloon with the right answer" color="#2E9E6B" onClick={() => setScreen("balloons")} />
        <MathModeButton icon={<BookMarked size={20} />} title="Word Problems" subtitle="Short illustrated problems to solve" color="#1D7A4C" onClick={() => setScreen("problems")} />
        <MathModeButton icon={<ListOrdered size={20} />} title="Equation Builder" subtitle="Drag the numbers into the right order" color="#2F4FB2" onClick={() => setScreen("builder")} />
        {missedCount > 0 && (
          <MathModeButton icon={<RotateCcw size={20} />} title={`Needs Practice (${missedCount})`} subtitle="Review facts he's missed before" color="#8E5A6B" onClick={() => setScreen("needsPractice")} />
        )}
        <MathModeButton icon={<ClipboardCheck size={20} />} title="Math Test" subtitle="Just listen and solve — no peeking" color="#1C2E6B" onClick={() => setScreen("test")} />
      </div>
    </div>
  );
}

function MathModeButton({ icon, title, subtitle, color, onClick }) {
  return (
    <button onClick={onClick} className="kbtn w-full rounded-2xl p-4 flex items-center gap-4 text-left" style={{ background: "#fff", border: "2px solid #C0392B" }}>
      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}22`, color }}>{icon}</div>
      <div className="flex-1">
        <div className="font-black text-base" style={{ color: "#1B2430" }}>{title}</div>
        <div className="text-xs" style={{ color: "#5B6B7A" }}>{subtitle}</div>
      </div>
      <ArrowRight size={18} style={{ color: "#E8A69C" }} />
    </button>
  );
}

function DotGroup({ n, color }) {
  return (
    <div className="flex flex-wrap gap-1.5 justify-center" style={{ maxWidth: 140 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-full" style={{ width: 14, height: 14, background: color }} />
      ))}
    </div>
  );
}

function LearnFactsMode({ grade, onExit, onMaster, onMiss, idx, setIdx }) {
  const facts = factList(grade);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState(null);
  const inputRef = useRef(null);
  const fact = facts[idx];
  const color = MATH_GRADE_COLOR[grade];

  useEffect(() => {
    mathSpeak(factSpeech(fact));
    setTyped("");
    setStatus(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [idx]); // eslint-disable-line

  function check() {
    if (parseInt(typed.trim(), 10) === fact.answer) {
      setStatus("correct");
      onMaster(grade, fact.id);
      playChime(true);
      recordActivity(MATH_ACTIVITY_KEY, true);
      mathSpeak("Great job!");
    } else {
      setStatus("wrong");
      playChime(false);
      recordActivity(MATH_ACTIVITY_KEY, false);
      if (onMiss) onMiss(grade, fact.id);
    }
  }
  function next() {
    if (idx + 1 < facts.length) setIdx(idx + 1); else onExit();
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <MathTopBar title={`Learn Facts · ${MATH_GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
      <div className="px-5 pt-6 text-center">
        <div className="text-xs font-bold mb-4" style={{ color: "#5B6B7A" }}>Fact {idx + 1} of {facts.length}</div>
        <div key={idx} className="pop rounded-3xl py-8 px-6 mb-5" style={{ background: "#fff", border: `3px solid ${color}` }}>
          {grade === "K" && (
            <div className="flex items-center justify-center gap-4 mb-4">
              <DotGroup n={fact.a} color={color} />
              <span className="text-2xl font-black" style={{ color: "#1B2430" }}>{fact.op}</span>
              <DotGroup n={fact.b} color="#2E9E6B" />
            </div>
          )}
          <div className="text-5xl font-black tracking-wide mb-4" style={{ color: "#1B2430" }}>{factDisplay(fact)}</div>
          <button onClick={() => mathSpeak(factSpeech(fact))} className="kbtn inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm" style={{ background: `${color}22`, color }}>
            <Volume2 size={16} /> Hear it again
          </button>
        </div>
        <div className="text-xs font-bold mb-2 text-left" style={{ color: "#5B6B7A" }}>Now type the answer:</div>
        <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric"
          onKeyDown={(e) => e.key === "Enter" && (status === "correct" ? next() : check())}
          className={`w-full text-center text-xl font-bold py-3 rounded-xl mb-3 outline-none ${status === "wrong" ? "shakeIt" : ""}`}
          style={{ border: `2px solid ${status === "correct" ? "#6FAE8B" : status === "wrong" ? "#D98551" : "#C0392B"}`, color: "#1B2430" }} placeholder="type here" />
        {status === "correct" && <div className="flex items-center justify-center gap-2 font-bold mb-4" style={{ color: "#6FAE8B" }}><CheckCircle2 size={18} /> Correct! Nice work.</div>}
        {status === "wrong" && <div className="flex items-center justify-center gap-2 font-bold mb-4" style={{ color: "#D98551" }}><XCircle size={18} /> Try again — count it out</div>}
        <div className="flex gap-2">
          {status !== "correct" ? (
            <button onClick={check} className="kbtn flex-1 py-3 rounded-xl font-black text-white" style={{ background: color }}>Check</button>
          ) : (
            <button onClick={next} className="kbtn flex-1 py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: color }}>Next Fact <ArrowRight size={16} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

function MathNeedsPracticeMode({ pool, onMaster, onSolved, onExit }) {
  const color = "#8E5A6B";
  const [order] = useState(() => shuffle(pool.map((m) => ({ ...m, fact: factList(m.grade).find((f) => f.id === m.factId) })).filter((m) => m.fact)));
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState(null);
  const inputRef = useRef(null);
  const item = order[idx];

  useEffect(() => {
    if (!item) return;
    mathSpeak(factSpeech(item.fact));
    setTyped("");
    setStatus(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [idx]); // eslint-disable-line

  if (order.length === 0) {
    return (
      <div className="max-w-md mx-auto pb-10">
        <MathTopBar title="Needs Practice" color={color} onExit={onExit} />
        <div className="px-5 pt-10 text-center">
          <CheckCircle2 size={48} style={{ color: "#6FAE8B" }} className="mx-auto mb-4" />
          <h2 className="text-xl font-black mb-2" style={{ color: "#1B2430" }}>All caught up!</h2>
          <p className="text-sm" style={{ color: "#5B6B7A" }}>Nothing needs review right now — great work.</p>
        </div>
      </div>
    );
  }

  function check() {
    if (parseInt(typed.trim(), 10) === item.fact.answer) {
      setStatus("correct");
      playChime(true);
      recordActivity(MATH_ACTIVITY_KEY, true);
      onMaster(item.grade, item.factId);
      onSolved(item.grade, item.factId);
      mathSpeak("Great job!");
    } else {
      setStatus("wrong");
      playChime(false);
      recordActivity(MATH_ACTIVITY_KEY, false);
    }
  }
  function next() {
    if (idx + 1 < order.length) setIdx(idx + 1); else onExit();
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <MathTopBar title="Needs Practice" color={color} onExit={onExit} />
      <div className="px-5 pt-6 text-center">
        <div className="text-xs font-bold mb-4" style={{ color: "#5B6B7A" }}>Fact {idx + 1} of {order.length}</div>
        <div key={idx} className="pop rounded-3xl py-10 px-6 mb-5" style={{ background: "#fff", border: `3px solid ${color}` }}>
          <div className="text-5xl font-black tracking-wide mb-4" style={{ color: "#1B2430" }}>{factDisplay(item.fact)}</div>
          <button onClick={() => mathSpeak(factSpeech(item.fact))} className="kbtn inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm" style={{ background: `${color}22`, color }}>
            <Volume2 size={16} /> Hear it again
          </button>
        </div>
        <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric"
          onKeyDown={(e) => e.key === "Enter" && (status === "correct" ? next() : check())}
          className={`w-full text-center text-xl font-bold py-3 rounded-xl mb-3 outline-none ${status === "wrong" ? "shakeIt" : ""}`}
          style={{ border: `2px solid ${status === "correct" ? "#6FAE8B" : status === "wrong" ? "#D98551" : "#C0392B"}`, color: "#1B2430" }} placeholder="type here" />
        {status === "correct" && <div className="flex items-center justify-center gap-2 font-bold mb-4" style={{ color: "#6FAE8B" }}><CheckCircle2 size={18} /> Got it!</div>}
        {status === "wrong" && <div className="flex items-center justify-center gap-2 font-bold mb-4" style={{ color: "#D98551" }}><XCircle size={18} /> Try again</div>}
        <div className="flex gap-2">
          {status !== "correct" ? (
            <button onClick={check} className="kbtn flex-1 py-3 rounded-xl font-black text-white" style={{ background: color }}>Check</button>
          ) : (
            <button onClick={next} className="kbtn flex-1 py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: color }}>Next <ArrowRight size={16} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

function MathTestMode({ grade, onExit, onFinish }) {
  const [order] = useState(() => mathShuffle(factList(grade)));
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [answers, setAnswers] = useState([]);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);
  const inputRef = useRef(null);
  const fact = order[idx];
  const color = MATH_GRADE_COLOR[grade];

  useEffect(() => {
    if (started && !done) {
      mathSpeak(factSpeech(fact));
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [idx, started, done]); // eslint-disable-line

  function submit() {
    const correct = parseInt(typed.trim(), 10) === fact.answer;
    playChime(correct);
    recordActivity(MATH_ACTIVITY_KEY, correct);
    const nextAnswers = [...answers, { problem: factDisplay(fact), answer: fact.answer, typed: typed.trim(), correct }];
    setAnswers(nextAnswers);
    setTyped("");
    if (idx + 1 < order.length) setIdx(idx + 1);
    else {
      const score = nextAnswers.filter((a) => a.correct).length;
      onFinish({ score, total: order.length, missed: nextAnswers.filter((a) => !a.correct).map((a) => a.problem) });
      setDone(true);
    }
  }

  if (!started) {
    return (
      <div className="max-w-md mx-auto pb-10">
        <MathTopBar title={`Math Test · ${MATH_GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <ClipboardCheck size={48} style={{ color }} className="mx-auto mb-4" />
          <h2 className="text-xl font-black mb-2" style={{ color: "#1B2430" }}>Ready for your test?</h2>
          <p className="text-sm mb-6" style={{ color: "#5B6B7A" }}>I'll say each problem out loud. You won't see it written — just listen and solve it. There are {order.length} problems.</p>
          <button onClick={() => setStarted(true)} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: color }}>Start Test</button>
        </div>
      </div>
    );
  }

  if (done) {
    const score = answers.filter((a) => a.correct).length;
    return (
      <div className="max-w-md mx-auto pb-10">
        <MathTopBar title="Test Complete" color={color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <Trophy size={52} style={{ color: "#2E9E6B" }} className="mx-auto mb-3" />
          <h2 className="text-2xl font-black mb-1" style={{ color: "#1B2430" }}>{score} / {answers.length} correct</h2>
          <p className="text-sm mb-6" style={{ color: "#5B6B7A" }}>{score === answers.length ? "Perfect score! Amazing work." : "Great effort — let's review the graded list below."}</p>

          <div className="text-left rounded-2xl p-4 mb-6" style={{ background: "#fff", border: "2px solid #C0392B" }}>
            <div className="font-black text-sm mb-3" style={{ color: "#1B2430" }}>Graded List</div>
            {answers.map((a, i) => (
              <div key={i} className="flex items-center gap-2 py-2 text-sm" style={{ borderBottom: i < answers.length - 1 ? "1px solid #C0392B" : "none" }}>
                <span className="font-bold w-6 shrink-0" style={{ color: "#5B6B7A" }}>{i + 1}.</span>
                <span className="font-bold shrink-0" style={{ color: "#1B2430" }}>{a.problem} =</span>
                {a.correct ? (
                  <span className="font-bold flex items-center gap-1.5" style={{ color: "#6FAE8B" }}>
                    <CheckCircle2 size={14} /> {a.answer}
                  </span>
                ) : (
                  <span className="flex-1 flex items-center flex-wrap gap-x-2">
                    <span className="font-bold flex items-center gap-1.5" style={{ color: "#D9432F" }}>
                      <XCircle size={14} /> {a.typed || "(blank)"}
                    </span>
                    <span style={{ color: "#5B6B7A" }}>→</span>
                    <span className="font-black" style={{ color: "#1B2430" }}>{a.answer}</span>
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={onExit} className="kbtn flex-1 py-3 rounded-xl font-black" style={{ background: "#E7ECFA", color: "#1B2430" }}><Home size={16} className="inline mr-1.5" /> Home</button>
            <button onClick={() => { setIdx(0); setAnswers([]); setDone(false); setStarted(true); }} className="kbtn flex-1 py-3 rounded-xl font-black text-white flex items-center justify-center gap-1.5" style={{ background: color }}><RotateCcw size={16} /> Retake</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <MathTopBar title={`Math Test · ${MATH_GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
      <div className="px-5 pt-8 text-center">
        <div className="text-xs font-bold mb-4" style={{ color: "#5B6B7A" }}>Question {idx + 1} of {order.length}</div>
        <div className="rounded-3xl py-12 px-6 mb-6" style={{ background: "#fff", border: `3px solid ${color}` }}>
          <button onClick={() => mathSpeak(factSpeech(fact))} className="kbtn inline-flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: `${color}22` }}><Volume2 size={28} style={{ color }} /></div>
            <span className="text-xs font-bold" style={{ color: "#5B6B7A" }}>Tap to hear it again</span>
          </button>
        </div>
        <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full text-center text-xl font-bold py-3 rounded-xl mb-4 outline-none" style={{ border: "2px solid #C0392B", color: "#1B2430" }}
          placeholder="type the answer" />
        <button onClick={submit} className="kbtn w-full py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: color }}>Submit <ArrowRight size={16} /></button>
      </div>
    </div>
  );
}

function EquationMatchMode({ grade, onExit }) {
  const color = "#4C6FD1";
  const PAIRS = 6;
  const queueRef = useRef([]);
  const [cards, setCards] = useState(() => buildDeck());
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const [round, setRound] = useState(1);
  const busyRef = useRef(false);

  function takeFacts(n) {
    const out = [];
    while (out.length < n) {
      if (queueRef.current.length === 0) queueRef.current = mathShuffle(factList(grade));
      out.push(queueRef.current.shift());
    }
    return out;
  }

  function buildDeck() {
    const facts = takeFacts(PAIRS);
    const deck = [];
    facts.forEach((f, i) => {
      deck.push({ id: `${i}p`, label: factDisplay(f), value: f.answer, type: "problem" });
      deck.push({ id: `${i}a`, label: String(f.answer), value: f.answer, type: "answer" });
    });
    return mathShuffle(deck);
  }

  function newRound() {
    setCards(buildDeck());
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setRound((r) => r + 1);
    busyRef.current = false;
  }

  function tapCard(idx) {
    if (busyRef.current) return;
    if (flipped.includes(idx) || matched.includes(idx)) return;
    const card = cards[idx];
    mathSpeak(card.type === "problem" ? factSpeechFromLabel(card.label) : card.label);
    const nextFlipped = [...flipped, idx];
    setFlipped(nextFlipped);

    if (nextFlipped.length === 2) {
      busyRef.current = true;
      setMoves((m) => m + 1);
      const [i1, i2] = nextFlipped;
      const c1 = cards[i1], c2 = cards[i2];
      const isMatch = c1.value === c2.value && c1.type !== c2.type;
      if (isMatch) {
        setTimeout(() => {
          setMatched((m) => [...m, i1, i2]);
          setFlipped([]);
          busyRef.current = false;
          playChime(true);
          recordActivity(MATH_ACTIVITY_KEY, true);
          mathSpeak("Match!");
        }, 500);
      } else {
        setTimeout(() => {
          setFlipped([]);
          busyRef.current = false;
        }, 900);
      }
    }
  }

  function factSpeechFromLabel(label) {
    return label.replace("+", " plus ").replace("-", " minus ").replace("×", " times ");
  }

  const allMatched = matched.length === cards.length;

  return (
    <div className="max-w-md mx-auto pb-10">
      <MathTopBar title={`Equation Match · ${MATH_GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
      <div className="px-5 pt-5">
        <div className="flex items-center justify-between mb-4 text-xs font-black" style={{ color: "#5B6B7A" }}>
          <span>Round {round}</span>
          <span>Moves: {moves}</span>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-5">
          {cards.map((card, idx) => {
            const isFlipped = flipped.includes(idx) || matched.includes(idx);
            const isMatched = matched.includes(idx);
            return (
              <button
                key={card.id}
                onClick={() => tapCard(idx)}
                className="kbtn rounded-xl flex items-center justify-center text-center font-black"
                style={{
                  height: 72,
                  background: isMatched ? "#6FAE8B22" : isFlipped ? "#fff" : color,
                  border: `2.5px solid ${isMatched ? "#6FAE8B" : color}`,
                  color: isMatched ? "#6FAE8B" : "#1B2430",
                  fontSize: isFlipped ? 15 : 22,
                  opacity: isMatched ? 0.7 : 1,
                }}
              >
                {isFlipped ? card.label : "?"}
              </button>
            );
          })}
        </div>

        {allMatched && (
          <div className="rounded-2xl p-5 text-center pop" style={{ background: "#fff", border: `2px solid ${color}` }}>
            <Trophy size={36} style={{ color: "#2E9E6B" }} className="mx-auto mb-2" />
            <div className="font-black text-lg mb-1" style={{ color: "#1B2430" }}>All matched in {moves} moves!</div>
            <button onClick={newRound} className="kbtn w-full py-3 rounded-xl font-black text-white mt-3 flex items-center justify-center gap-2" style={{ background: color }}>
              Next Round <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BalloonPopMathMode({ grade, onExit }) {
  const color = "#2E9E6B";
  const calm = getCalmMode();
  const ROUND = calm ? 65 : 45;
  const COLUMNS = ["#2F4FB2", "#4C6FD1", "#1C2E6B", "#1D7A4C", "#2E9E6B"];
  const queueRef = useRef([]);
  const [phase, setPhase] = useState("intro");
  const [timeLeft, setTimeLeft] = useState(ROUND);
  const [score, setScore] = useState(0);
  const [fact, setFact] = useState(factList(grade)[0]);
  const [balloons, setBalloons] = useState([]);
  const balloonId = useRef(0);
  const factRef = useRef(fact);

  useEffect(() => { factRef.current = fact; }, [fact]);

  function takeOne() {
    if (queueRef.current.length === 0) queueRef.current = mathShuffle(factList(grade));
    return queueRef.current.shift();
  }

  useEffect(() => {
    if (phase !== "playing") return;
    mathSpeak(factSpeech(fact));
    const timerId = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { setPhase("done"); return 0; }
        return t - 1;
      });
    }, 1000);
    const spawnId = setInterval(() => { spawnBalloon(); }, calm ? 1800 : 1200);
    return () => { clearInterval(timerId); clearInterval(spawnId); };
  }, [phase]); // eslint-disable-line

  function decoyAnswer(correct) {
    const delta = Math.max(1, Math.floor(Math.random() * 5) + 1);
    const v = Math.random() > 0.5 ? correct + delta : correct - delta;
    return v < 0 ? correct + delta : v;
  }

  function spawnBalloon() {
    const id = balloonId.current++;
    const useCorrect = Math.random() < 0.35;
    const value = useCorrect ? factRef.current.answer : decoyAnswer(factRef.current.answer);
    const left = 8 + Math.random() * 78;
    const duration = calm ? 9 + Math.random() * 3 : 6 + Math.random() * 2.5;
    const col = COLUMNS[Math.floor(Math.random() * COLUMNS.length)];
    setBalloons((b) => [...b, { id, value, left, duration, col }]);
    setTimeout(() => setBalloons((b) => b.filter((bal) => bal.id !== id)), duration * 1000 + 50);
  }

  function startRound() {
    setScore(0);
    setTimeLeft(ROUND);
    setBalloons([]);
    const f = takeOne();
    setFact(f);
    setPhase("playing");
  }

  function popBalloon(id, value) {
    if (value !== fact.answer) return;
    setScore((s) => s + 1);
    setBalloons((b) => b.filter((bal) => bal.id !== id));
    playChime(true);
    recordActivity(MATH_ACTIVITY_KEY, true);
    const f = takeOne();
    setFact(f);
    mathSpeak(factSpeech(f));
  }

  if (phase === "intro") {
    return (
      <div className="max-w-md mx-auto pb-10">
        <MathTopBar title={`Balloon Pop · ${MATH_GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <div className="text-5xl mb-4">🎈</div>
          <h2 className="text-xl font-black mb-2" style={{ color: "#1B2430" }}>Ready to pop some answers?</h2>
          <p className="text-sm mb-6" style={{ color: "#5B6B7A" }}>I'll say a problem. Pop the balloon with the right answer before it floats away!</p>
          <button onClick={startRound} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: "#1B2430" }}>Start Game</button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="max-w-md mx-auto pb-10">
        <MathTopBar title="Game Over" color={color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <Trophy size={52} style={{ color }} className="mx-auto mb-3" />
          <h2 className="text-2xl font-black mb-1" style={{ color: "#1B2430" }}>{score} balloons popped!</h2>
          <p className="text-sm mb-6" style={{ color: "#5B6B7A" }}>Great job solving those problems.</p>
          <div className="flex gap-2">
            <button onClick={onExit} className="kbtn flex-1 py-3 rounded-xl font-black" style={{ background: "#E7ECFA", color: "#1B2430" }}><Home size={16} className="inline mr-1.5" /> Home</button>
            <button onClick={startRound} className="kbtn flex-1 py-3 rounded-xl font-black text-white flex items-center justify-center gap-1.5" style={{ background: "#1B2430" }}><RotateCcw size={16} /> Play Again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "#F5F8FC", height: "100dvh" }}>
      <style>{`@keyframes floatUp { from { bottom: -12%; } to { bottom: 105%; } }`}</style>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "2px solid #C0392B", paddingRight: 84 }}>
        <button onClick={onExit} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#1B2430", background: "#E7ECFA" }}>
          <Home size={16} /> Home
        </button>
        <div className="text-xs font-black" style={{ color: "#1B2430" }}>Score: {score}</div>
        <div className="text-xs font-black" style={{ color: "#D98551" }}>⏱ {timeLeft}s</div>
      </div>

      <button onClick={() => mathSpeak(factSpeech(fact))} className="kbtn mx-4 mt-3 rounded-2xl py-3 flex items-center justify-center gap-2 shrink-0" style={{ background: "#1B2430" }}>
        <Volume2 size={16} color="#2E9E6B" />
        <span className="text-white font-black">Solve: {factDisplay(fact)}</span>
      </button>

      <div className="flex-1 relative overflow-hidden mx-2 mt-2 mb-2 rounded-2xl" style={{ background: "linear-gradient(180deg, #E7F0FA, #F5F8FC)" }}>
        {balloons.map((b) => (
          <button
            key={b.id}
            onClick={() => popBalloon(b.id, b.value)}
            className="absolute flex flex-col items-center"
            style={{ left: `${b.left}%`, animation: `floatUp ${b.duration}s linear forwards`, transform: "translateX(-50%)" }}
          >
            <div
              className="rounded-full flex items-center justify-center font-black px-2 shadow-md text-center"
              style={{
                width: Math.max(74, Math.min(120, String(b.value).length * 11 + 30)),
                height: 88,
                fontSize: String(b.value).length > 4 ? 12 : 14,
                background: b.col,
                color: "#fff",
                borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
              }}
            >
              {b.value}
            </div>
            <div style={{ width: 2, height: 14, background: "#E8A69C" }} />
          </button>
        ))}
      </div>
    </div>
  );
}

const MATH_SCENE_STICKERS = {
  apples: ["🍎", "🌳", "✨"],
  ducks: ["🦆", "💧", "☀️"],
  stars: ["⭐", "🌙", "✨"],
  cars: ["🚗", "🎁", "❤️"],
  cookies: ["🍪", "🫙", "😋"],
  marbles: ["🔵", "🔴", "✨"],
  cupcakes: ["🧁", "🎉", "✨"],
  stickers: ["⭐", "🎨", "✨"],
  walk: ["🚶", "🌳", "☀️"],
  books: ["📚", "📖", "✨"],
  team: ["⚽", "🏃", "🤝"],
  garden2: ["🍅", "🌱", "☀️"],
  money: ["💵", "🎟️", "✨"],
  boxes: ["📦", "🏭", "✅"],
  roadtrip: ["🚗", "🛣️", "🗺️"],
};

function AIWordProblemMode({ grade, onExit, onBack }) {
  const color = "#1D7A4C";
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [problem, setProblem] = useState(null);
  const CHIPS = ["Dinosaurs", "Video Games", "Sports", "Space", "Animals", "Snacks"];

  async function generate(chosenTopic) {
    setLoading(true);
    setError(false);
    const facts = factList(grade).slice(0, 10).map((f) => factDisplay(f)).join(", ");
    const prompt = `Write one short math word problem for a ${MATH_GRADE_LABEL[grade]} student, themed around "${chosenTopic}". Base the numbers/operation on this student's current level, similar to these example facts: ${facts}. Keep it to 2-3 short sentences, fun and concrete. Then give the numeric answer and one comprehension-style question with 3 multiple choice numeric answers (only one correct). Respond ONLY with JSON, no markdown fences: {"title": "...", "text": "...", "question": {"prompt": "...", "options": [n1, n2, n3], "correct": 0}}`;
    const reply = await askClaude(prompt, 500);
    const parsed = extractJson(reply);
    setLoading(false);
    if (parsed && parsed.title && parsed.text && parsed.question) {
      setProblem({ ...parsed, scene: "ai-" + chosenTopic });
    } else {
      setError(true);
    }
  }

  if (problem) {
    return <WordProblemReader problem={problem} color={color} onBack={() => setProblem(null)} onExit={onExit} />;
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <MathTopBar title="Make Me a Problem" color={color} onExit={onBack} />
      <div className="px-5 pt-6">
        {!loading && (
          <>
            <p className="text-sm mb-4" style={{ color: "#5B6B7A" }}>What should the problem be about?</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {CHIPS.map((c) => (
                <button key={c} onClick={() => generate(c)} className="kbtn px-3 py-2 rounded-full font-bold text-sm" style={{ background: "#F5F8FC", color: "#1B2430", border: "1px solid #E7ECFA" }}>{c}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && topic.trim() && generate(topic.trim())}
                placeholder="Or type your own idea..."
                className="flex-1 text-sm px-4 py-3 rounded-xl outline-none"
                style={{ border: "2px solid #E7ECFA", color: "#1B2430" }}
              />
              <button onClick={() => topic.trim() && generate(topic.trim())} disabled={!topic.trim()} className="kbtn w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: color, opacity: topic.trim() ? 1 : 0.5 }}>
                <Send size={18} color="#fff" />
              </button>
            </div>
          </>
        )}
        {loading && (
          <div className="rounded-2xl p-8 text-center" style={{ background: "#fff", border: "2px solid #E7ECFA" }}>
            <div className="text-4xl mb-3">✍️</div>
            <div className="text-sm font-bold" style={{ color: "#5B6B7A" }}>Writing your problem...</div>
          </div>
        )}
        {error && !loading && (
          <div className="rounded-2xl p-5 text-center" style={{ background: "#fff", border: "2px solid #D98551" }}>
            <div className="text-sm font-bold" style={{ color: "#D98551" }}>Couldn't reach the tutor — check your connection and try again.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function WordProblemsMode({ grade, onExit }) {
  const [openIdx, setOpenIdx] = useState(null);
  const [aiMode, setAiMode] = useState(false);
  const color = "#1D7A4C";
  const problems = WORD_PROBLEMS[grade];

  if (aiMode) return <AIWordProblemMode grade={grade} onExit={onExit} onBack={() => setAiMode(false)} />;
  if (openIdx !== null) {
    return <WordProblemReader problem={problems[openIdx]} color={color} onBack={() => setOpenIdx(null)} onExit={onExit} />;
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <MathTopBar title={`Word Problems · ${MATH_GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
      <div className="px-5 pt-5">
        <button onClick={() => setAiMode(true)} className="kbtn w-full rounded-2xl p-4 mb-5 flex items-center gap-3 text-left" style={{ background: "#1B2430" }}>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
            <Sparkles size={20} color="#fff" />
          </div>
          <div className="flex-1">
            <div className="text-white font-black text-sm">Make Me a New Problem</div>
            <div className="text-xs" style={{ color: "#B8C4E0" }}>About whatever he's into — a fresh one every time</div>
          </div>
          <ArrowRight size={18} color="#fff" />
        </button>

        <p className="text-xs mb-4" style={{ color: "#5B6B7A" }}>Numbers are highlighted — tap any number to hear it.</p>
        <div className="space-y-3">
          {problems.map((p, i) => (
            <button key={p.title} onClick={() => setOpenIdx(i)} className="kbtn w-full rounded-2xl p-4 flex items-center gap-4 text-left" style={{ background: "#fff", border: "2px solid #C0392B" }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-2xl" style={{ background: `${color}15` }}>
                {(MATH_SCENE_STICKERS[p.scene] || ["🔢"])[0]}
              </div>
              <div className="flex-1">
                <div className="font-black text-base" style={{ color: "#1B2430" }}>{p.title}</div>
                <div className="text-xs" style={{ color: "#5B6B7A" }}>{p.text.split(" ").length} words</div>
              </div>
              <ArrowRight size={18} style={{ color: "#E8A69C" }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WordProblemReader({ problem, color, onBack, onExit }) {
  const sentences = problem.text.match(/[^.!?]+[.!?]+/g) || [problem.text];
  const SENTENCE_COLORS = ["#1B2430", "#1C2E6B", "#1D7A4C", "#2E9E6B", "#1D7A4C"];
  const stickers = MATH_SCENE_STICKERS[problem.scene] || ["✨"];
  const [picked, setPicked] = useState(null);
  const [checked, setChecked] = useState(false);
  const questionRef = useRef(null);
  const hasAutoPlayedRef = useRef(false);

  function readWhole() { mathSpeak(problem.text, 0.95); }
  function readQuestion() {
    mathSpeakSequence([problem.question.prompt, ...problem.question.options.map((o, i) => `Choice ${i + 1}: ${o}`)], 0.85, 400);
  }

  useEffect(() => {
    setPicked(null);
    setChecked(false);
    hasAutoPlayedRef.current = false;
  }, [problem.title]);

  useEffect(() => {
    const el = questionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !hasAutoPlayedRef.current) {
        hasAutoPlayedRef.current = true;
        readQuestion();
      }
    }, { threshold: 0.6 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [problem.title]); // eslint-disable-line

  function checkAnswer() {
    if (picked === null) return;
    setChecked(true);
    if (picked === problem.question.correct) mathSpeak("That's right!");
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6" style={{ borderBottom: "2px solid #C0392B" }}>
        <button onClick={onBack} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#1B2430", background: "#E7ECFA" }}>
          <ArrowLeft size={16} /> Problems
        </button>
        <button onClick={onExit} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#1B2430", background: "#E7ECFA" }}>
          <Home size={16} />
        </button>
      </div>

      <div className="px-5 pt-5">
        <h2 className="text-xl font-black mb-3" style={{ color: "#1B2430" }}>{problem.title}</h2>

        <div className="w-full rounded-2xl overflow-hidden mb-4 flex items-center justify-center text-6xl" style={{ height: 160, border: "2px solid #C0392B", background: "linear-gradient(180deg,#E7F0FA,#F5F8FC)" }}>
          {stickers[0]}
        </div>

        <button onClick={readWhole} className="kbtn w-full mb-4 rounded-xl py-3 flex items-center justify-center gap-2 font-black text-white" style={{ background: color }}>
          <Volume2 size={18} /> Read the Whole Problem
        </button>

        <div className="rounded-2xl p-5 mb-4" style={{ background: "#fff", border: "2px solid #C0392B" }}>
          {sentences.map((sentence, sIdx) => {
            const sColor = SENTENCE_COLORS[sIdx % SENTENCE_COLORS.length];
            const tokens = sentence.split(/(\s+)/);
            return (
              <React.Fragment key={sIdx}>
                <div className="text-lg mb-2 last:mb-0" style={{ color: sColor, lineHeight: 2, letterSpacing: "0.01em", wordSpacing: "0.2em" }}>
                  {tokens.map((tok, i) => {
                    const clean = tok.trim();
                    const isNum = /^\d+$/.test(clean);
                    if (!clean || /^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
                    if (!isNum) {
                      return (
                        <span key={i} onClick={() => mathSpeak(clean.replace(/[^a-zA-Z']/g, ""))} className="cursor-pointer" style={{ borderBottom: "1.5px dotted #E8A69C" }}>
                          {tok}
                        </span>
                      );
                    }
                    return (
                      <span key={i} onClick={() => mathSpeak(clean)} className="font-black cursor-pointer"
                        style={{ background: `${color}33`, color: "#1B2430", borderRadius: 4, padding: "1px 3px" }}>
                        {tok}
                      </span>
                    );
                  })}
                </div>
                {sIdx < sentences.length - 1 && (
                  <div className="text-4xl text-center mb-3 select-none" aria-hidden="true">{stickers[sIdx % stickers.length]}</div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        <p className="text-xs text-center mb-5" style={{ color: "#5B6B7A" }}>Tap any word or number to hear it read aloud.</p>

        <div ref={questionRef} className="rounded-2xl p-4" style={{ background: "#fff", border: `2px solid ${color}` }}>
          <div className="flex items-start gap-2 mb-3">
            <div className="font-black text-sm flex-1" style={{ color: "#1B2430" }}>{problem.question.prompt}</div>
            <button onClick={readQuestion} className="kbtn w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: `${color}22`, color }}>
              <Volume2 size={16} />
            </button>
          </div>
          <div className="space-y-2 mb-3">
            {problem.question.options.map((opt, i) => {
              const isPicked = picked === i;
              const isCorrect = i === problem.question.correct;
              let bg = "#F5F8FC", border = "#C0392B", text = "#1B2430";
              if (checked && isPicked && isCorrect) { bg = "#6FAE8B22"; border = "#6FAE8B"; }
              else if (checked && isPicked && !isCorrect) { bg = "#D9432F22"; border = "#D9432F"; }
              else if (isPicked) { border = color; }
              return (
                <button key={i} onClick={() => { if (!checked) setPicked(i); }} className="kbtn w-full text-left px-4 py-2.5 rounded-xl font-bold text-sm"
                  style={{ background: bg, border: `2px solid ${border}`, color: text }}>
                  {opt}
                </button>
              );
            })}
          </div>
          {!checked ? (
            <button onClick={checkAnswer} disabled={picked === null} className="kbtn w-full py-2.5 rounded-xl font-black text-white" style={{ background: color, opacity: picked === null ? 0.5 : 1 }}>
              Check Answer
            </button>
          ) : (
            <div className="text-center text-sm font-bold" style={{ color: picked === problem.question.correct ? "#6FAE8B" : "#D9432F" }}>
              {picked === problem.question.correct ? "Great math! That's correct." : `Good try — the answer was ${problem.question.options[problem.question.correct]}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EquationBuilderMode({ grade, onExit }) {
  const color = "#2F4FB2";
  const pool = EQUATION_POOLS[grade];
  const queueRef = useRef([]);
  const [tiles, setTiles] = useState([]);
  const [answerText, setAnswerText] = useState("");
  const [bank, setBank] = useState([]);
  const [built, setBuilt] = useState([]);
  const [status, setStatus] = useState(null);
  const [round, setRound] = useState(1);
  const [drag, setDrag] = useState(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const builtZoneRef = useRef(null);
  const tileRefs = useRef({});

  function loadEquation() {
    if (queueRef.current.length === 0) queueRef.current = mathShuffle(pool);
    const eq = queueRef.current.shift();
    const parts = [String(eq.a), eq.op, String(eq.b), "=", String(eq.answer)].map((t, i) => ({ id: i, text: t }));
    setTiles(parts);
    setAnswerText(parts.map((p) => p.text).join(" "));
    setBank(mathShuffle(parts));
    setBuilt([]);
    setStatus(null);
  }

  useEffect(() => { loadEquation(); }, [grade]); // eslint-disable-line

  function speakTile(item) {
    if (item.text === "+") mathSpeak("plus");
    else if (item.text === "-") mathSpeak("minus");
    else if (item.text === "×") mathSpeak("times");
    else if (item.text === "=") mathSpeak("equals");
    else mathSpeak(item.text);
  }

  function computeInsertIndex(x, excludeId) {
    const entries = built.filter((w) => w.id !== excludeId);
    for (let i = 0; i < entries.length; i++) {
      const el = tileRefs.current[entries[i].id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (x < rect.left + rect.width / 2) return i;
    }
    return entries.length;
  }

  function onTileDown(e, item, source) {
    if (status === "correct") return;
    const p = e.touches ? e.touches[0] : e;
    startPosRef.current = { x: p.clientX, y: p.clientY };
    movedRef.current = false;
    setDrag({ item, source, x: p.clientX, y: p.clientY });
  }

  useEffect(() => {
    if (!drag) return;
    function move(e) {
      e.preventDefault();
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - startPosRef.current.x;
      const dy = p.clientY - startPosRef.current.y;
      if (Math.hypot(dx, dy) > 10) movedRef.current = true;
      setDrag((d) => (d ? { ...d, x: p.clientX, y: p.clientY } : d));
    }
    function up(e) {
      const p = e.changedTouches ? e.changedTouches[0] : e;
      finishDrag(p.clientX, p.clientY);
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [drag]); // eslint-disable-line

  function finishDrag(x, y) {
    setDrag((d) => {
      if (!d) return null;
      const { item, source } = d;
      const wasTap = !movedRef.current;
      if (wasTap) { speakTile(item); return null; }
      const rect = builtZoneRef.current?.getBoundingClientRect();
      const inZone = rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

      if (source === "bank") {
        if (inZone) {
          const idx = computeInsertIndex(x);
          setBank((b) => b.filter((w) => w.id !== item.id));
          setBuilt((b) => { const next = [...b]; next.splice(idx, 0, item); return next; });
          setStatus(null);
        }
      } else {
        if (inZone) {
          const idx = computeInsertIndex(x, item.id);
          setBuilt((b) => { const next = b.filter((w) => w.id !== item.id); next.splice(idx, 0, item); return next; });
          setStatus(null);
        } else {
          setBuilt((b) => b.filter((w) => w.id !== item.id));
          setBank((b) => [...b, item]);
          setStatus(null);
        }
      }
      return null;
    });
  }

  function checkEquation() {
    const attempt = built.map((w) => w.text).join(" ");
    if (attempt === answerText) {
      setStatus("correct");
      mathSpeak("Correct equation!");
    } else {
      setStatus("wrong");
    }
  }

  function nextEquation() {
    setRound((r) => r + 1);
    loadEquation();
  }

  const allPlaced = bank.length === 0 && built.length > 0;

  return (
    <div className="max-w-md mx-auto pb-10">
      <MathTopBar title={`Equation Builder · ${MATH_GRADE_LABEL[grade]}`} color={color} onExit={onExit} />
      <div className="px-5 pt-6">
        <div className="text-xs font-bold mb-4 text-center" style={{ color: "#5B6B7A" }}>Round {round}</div>

        <div ref={builtZoneRef} className="rounded-2xl p-4 mb-4 min-h-[70px] flex flex-wrap gap-2 items-center justify-center"
          style={{ background: drag && drag.source === "bank" ? `${color}11` : "#fff", border: `2.5px solid ${color}` }}>
          {built.length === 0 && <span className="text-xs" style={{ color: "#E8A69C" }}>Drag the tiles here to build the equation</span>}
          {built.map((w) => (
            <button key={w.id} ref={(el) => { if (el) tileRefs.current[w.id] = el; }}
              onPointerDown={(e) => onTileDown(e, w, "built")} onTouchStart={(e) => onTileDown(e, w, "built")}
              className="kbtn px-4 py-2 rounded-lg font-black text-lg text-white touch-none"
              style={{ background: color, opacity: drag && drag.item.id === w.id ? 0.25 : 1, touchAction: "none" }}>
              {w.text}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 justify-center mb-2">
          {bank.map((w) => (
            <button key={w.id} onPointerDown={(e) => onTileDown(e, w, "bank")} onTouchStart={(e) => onTileDown(e, w, "bank")}
              className="kbtn px-4 py-2.5 rounded-lg font-black text-lg flex items-center gap-1.5 touch-none"
              style={{ background: "#E7ECFA", color: "#1B2430", opacity: drag && drag.item.id === w.id ? 0.25 : 1, touchAction: "none" }}>
              {w.text}
            </button>
          ))}
        </div>
        <p className="text-xs text-center mb-5" style={{ color: "#5B6B7A" }}>Tap a tile to hear it. Drag it into the box above to place it.</p>

        {status === "wrong" && <div className="text-center text-sm font-bold mb-3" style={{ color: "#D98551" }}>Not quite — drag a tile to fix the order and try again.</div>}
        {status === "correct" && (
          <div className="text-center text-sm font-bold mb-3" style={{ color: "#6FAE8B" }}>
            <CheckCircle2 size={16} className="inline mr-1" /> Great equation!
          </div>
        )}

        {status !== "correct" ? (
          <button onClick={checkEquation} disabled={!allPlaced} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: color, opacity: allPlaced ? 1 : 0.5 }}>
            Check Equation
          </button>
        ) : (
          <button onClick={nextEquation} className="kbtn w-full py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: color }}>
            Next Equation <ArrowRight size={16} />
          </button>
        )}
      </div>

      {drag && movedRef.current && (
        <div className="fixed px-4 py-2 rounded-lg font-black text-lg text-white pointer-events-none"
          style={{ left: drag.x - 20, top: drag.y - 20, background: color, zIndex: 60, boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}>
          {drag.item.text}
        </div>
      )}
    </div>
  );
}

function MathProgressReport({ progress, onExit }) {
  const [streakData, setStreakData] = useState(null);
  const [activityLog, setActivityLog] = useState([]);
  const [analytics, setAnalytics] = useState(emptyAnalytics());

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(MATH_STREAK_KEY);
        if (res && res.value) setStreakData(JSON.parse(res.value));
      } catch (e) {}
    })();
    (async () => {
      try {
        const res = await window.storage.get(MATH_ACTIVITY_KEY);
        if (res && res.value) setActivityLog(JSON.parse(res.value));
      } catch (e) {}
    })();
    (async () => {
      const a = await loadAnalytics();
      setAnalytics({ ...a });
    })();
  }, []);

  const totalSeconds = Object.values(analytics.dailyLog).reduce((s, d) => s + (d.seconds || 0), 0);
  const totalAnswers = Object.values(analytics.dailyLog).reduce((s, d) => s + (d.total || 0), 0);
  const totalCorrect = Object.values(analytics.dailyLog).reduce((s, d) => s + (d.correct || 0), 0);
  const activeDays = Object.values(analytics.dailyLog).filter((d) => d.total > 0).length;
  const acc = totalAnswers ? Math.round((totalCorrect / totalAnswers) * 100) : 0;

  return (
    <div className="max-w-md mx-auto pb-10">
      <MathTopBar title="Progress Report" color="#1B2430" onExit={onExit} />
      <div className="px-5 pt-6">
        {streakData && (
          <div className="rounded-2xl p-4 mb-5 flex items-center gap-4" style={{ background: "#fff", border: "2px solid #C0392B" }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: "#2E9E6B22" }}>
              <Flame size={22} style={{ color: "#1D7A4C" }} />
            </div>
            <div>
              <div className="font-black text-sm" style={{ color: "#1B2430" }}>{streakData.currentStreak} day{streakData.currentStreak === 1 ? "" : "s"} in a row</div>
              <div className="text-xs" style={{ color: "#5B6B7A" }}>Best streak: {streakData.longestStreak} day{streakData.longestStreak === 1 ? "" : "s"}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 mb-5">
          <StatTile label="practiced" value={formatMinutes(totalSeconds)} color="#2F4FB2" />
          <StatTile label="days" value={activeDays} color="#1D7A4C" />
          <StatTile label="answers" value={totalAnswers} color="#4C6FD1" />
          <StatTile label="accuracy" value={`${acc}%`} color="#C0392B" />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #C0392B" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-black text-sm" style={{ color: "#1B2430" }}>Focus Timeline</div>
            <div className="text-xs font-bold" style={{ color: "#1D7A4C" }}>{computePace(activityLog)} correct/min</div>
          </div>
          <FocusTimeline log={activityLog} activeColor="#2F4FB2" idleColor="#E7ECFA" />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #C0392B" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#1B2430" }}>Hardest Facts</div>
          <HardestList missCounts={analytics.missCounts} filterPrefix="math:" accent="#C0392B"
            emptyMsg="Nothing missed repeatedly yet — this fills in as he practices." />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #C0392B" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#1B2430" }}>What He Actually Uses</div>
          <ModeUsageList modeUsage={analytics.modeUsage} labels={MATH_MODE_LABELS_REPORT} accent="#4C6FD1" />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #C0392B" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#1B2430" }}>Best Time of Day</div>
          <BestTimeOfDay hourAccuracy={analytics.hourAccuracy} accent="#1D7A4C" />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #C0392B" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#1B2430" }}>Practice Consistency</div>
          <ConsistencyCalendar dailyLog={analytics.dailyLog} accent="#2F4FB2" />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #C0392B" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#1B2430" }}>Facts Mastered Over Time</div>
          <TrendChart snapshots={analytics.snapshots} field="mathMastered" accent="#2F4FB2" label="facts" />
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #C0392B" }}>
          <div className="font-black text-sm mb-2.5" style={{ color: "#1B2430" }}>Math Test History</div>
          <TestHistoryList testHistory={analytics.testHistory} subjectFilter="math" gradeLabels={MATH_GRADE_LABEL} accent="#2F4FB2" />
        </div>

        <button
          onClick={() => {
            const hardest = Object.entries(analytics.missCounts).filter(([k]) => k.startsWith("math:"))
              .sort((a, b) => b[1] - a[1]).slice(0, 10)
              .map(([k, c]) => `<li>${k.split(":").slice(2).join(":")} — missed ${c} time${c === 1 ? "" : "s"}</li>`).join("");
            const perGrade = Object.keys(MATH_GRADE_LABEL).map((g) =>
              `<li>${MATH_GRADE_LABEL[g]}: ${(progress[g]?.mastered || []).length} of ${FACTS[g].length} facts mastered${progress[g]?.lastTest ? ` — last test ${progress[g].lastTest.score}/${progress[g].lastTest.total}` : ""}</li>`).join("");
            printReport("Math Progress Summary", `
              <h2>Overview</h2>
              <ul>
                <li>Total practice time: ${formatMinutes(totalSeconds)}</li>
                <li>Total answers given: ${totalAnswers} (${acc}% correct)</li>
                <li>Current streak: ${streakData ? streakData.currentStreak : 0} day(s)</li>
              </ul>
              <h2>Progress by Grade Level</h2><ul>${perGrade}</ul>
              <h2>Most Frequently Missed Facts</h2>
              <ul>${hardest || "<li>None recorded yet.</li>"}</ul>
              <h2>Note</h2>
              <p style="font-size:12px;color:#6b6259">This summary reflects in-app practice only and is not a diagnostic assessment.</p>
            `);
          }}
          className="kbtn w-full py-3 rounded-xl font-black text-white mb-5 flex items-center justify-center gap-2"
          style={{ background: "#1B2430" }}
        >
          <FileText size={16} /> Print / Save Summary for Teacher
        </button>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #C0392B" }}>
          <div className="font-black text-sm mb-2" style={{ color: "#1B2430" }}>Badges</div>
          <BadgeRow badges={computeBadges(progress, streakData ? streakData.currentStreak : 0)} />
        </div>

        {Object.keys(MATH_GRADE_LABEL).map((g) => {
          const total = FACTS[g].length;
          const gp = progress[g] || { mastered: [], lastTest: null };
          const mastered = gp.mastered.length;
          const lastTest = gp.lastTest;
          return (
            <div key={g} className="rounded-2xl p-4 mb-4" style={{ background: "#fff", border: `2px solid ${MATH_GRADE_COLOR[g]}` }}>
              <div className="font-black text-sm mb-2" style={{ color: MATH_GRADE_COLOR[g] }}>{MATH_GRADE_LABEL[g]}</div>
              <div className="text-xs font-bold mb-1.5" style={{ color: "#1B2430" }}>{mastered} / {total} facts mastered</div>
              <div className="h-2 rounded-full mb-3 overflow-hidden" style={{ background: "#E7ECFA" }}>
                <div className="h-full rounded-full" style={{ width: `${(mastered / total) * 100}%`, background: MATH_GRADE_COLOR[g] }} />
              </div>
              {lastTest ? (
                <>
                  <div className="text-xs font-bold mb-1" style={{ color: "#5B6B7A" }}>Last math test: {lastTest.score}/{lastTest.total}</div>
                  {lastTest.missed && lastTest.missed.length > 0 && (
                    <div className="text-xs" style={{ color: "#5B6B7A" }}>Problems to review: {lastTest.missed.join(", ")}</div>
                  )}
                </>
              ) : (
                <div className="text-xs" style={{ color: "#5B6B7A" }}>No math test taken yet</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


function SettingsPanel({ settings, onChange, onBack }) {
  return (
    <div className="min-h-screen px-6 py-8" style={{ background: "#F5F8FC" }}>
      <div className="max-w-sm mx-auto">
        <button onClick={onBack} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full mb-6" style={{ color: "#1B2430", background: "#EEE6D6" }}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="text-xl font-black mb-6" style={{ color: "#1B2430" }}>Settings</h1>

        <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="font-black text-sm mb-2" style={{ color: "#1B2430" }}>Text Size</div>
          <div className="flex gap-2">
            {["normal", "large"].map((v) => (
              <button key={v} onClick={() => onChange({ fontScale: v })} className="kbtn flex-1 py-2.5 rounded-xl font-black text-sm capitalize"
                style={{ background: settings.fontScale === v ? "#2B2250" : "#EEE6D6", color: settings.fontScale === v ? "#fff" : "#1B2430" }}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-black text-sm" style={{ color: "#1B2430" }}>Dyslexia-Friendly Spacing</div>
              <div className="text-xs" style={{ color: "#5B6B7A" }}>Wider letter and word spacing throughout</div>
            </div>
            <button onClick={() => onChange({ dyslexiaSpacing: !settings.dyslexiaSpacing })} className="kbtn shrink-0 rounded-full" style={{ width: 44, height: 26, background: settings.dyslexiaSpacing ? "#6FAE8B" : "#EEE6D6", position: "relative" }}>
              <span style={{ position: "absolute", top: 3, left: settings.dyslexiaSpacing ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 150ms" }} />
            </button>
          </div>
        </div>

        <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-black text-sm" style={{ color: "#1B2430" }}>Calm Game Mode</div>
              <div className="text-xs" style={{ color: "#5B6B7A" }}>Slower balloons, more time on timed games</div>
            </div>
            <button onClick={() => onChange({ calmMode: !settings.calmMode })} className="kbtn shrink-0 rounded-full" style={{ width: 44, height: 26, background: settings.calmMode ? "#6FAE8B" : "#EEE6D6", position: "relative" }}>
              <span style={{ position: "absolute", top: 3, left: settings.calmMode ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 150ms" }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function upperTotalForSubject(subject) {
  let total = 0;
  UPPER_GRADES.forEach((g) => UPPER_CONTENT[subject][g].forEach((t) => { total += t.cards.length; }));
  return total;
}
function upperMasteredForSubject(subject, upperProgress) {
  let count = 0;
  Object.keys(upperProgress).forEach((k) => {
    if (k.startsWith(`${subject}:`)) count += (upperProgress[k] || []).length;
  });
  return count;
}

function CombinedProgressReport({ onExit }) {
  const [readingProgress, setReadingProgress] = useState(null);
  const [mathProgress, setMathProgress] = useState(null);
  const [upperProgress, setUpperProgress] = useState(null);
  const [streakData, setStreakData] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY);
        if (res && res.value) setReadingProgress({ ...emptyProgress(), ...JSON.parse(res.value) });
        else setReadingProgress(emptyProgress());
      } catch (e) { setReadingProgress(emptyProgress()); }
    })();
    (async () => {
      try {
        const res = await window.storage.get(MATH_STORAGE_KEY);
        if (res && res.value) setMathProgress({ ...mathEmptyProgress(), ...JSON.parse(res.value) });
        else setMathProgress(mathEmptyProgress());
      } catch (e) { setMathProgress(mathEmptyProgress()); }
    })();
    (async () => {
      try {
        const res = await window.storage.get(UPPER_PROGRESS_KEY);
        if (res && res.value) setUpperProgress(JSON.parse(res.value));
        else setUpperProgress({});
      } catch (e) { setUpperProgress({}); }
    })();
    (async () => {
      try {
        const res = await window.storage.get(STREAK_KEY);
        if (res && res.value) setStreakData(JSON.parse(res.value));
      } catch (e) {}
    })();
  }, []);

  if (!readingProgress || !mathProgress || !upperProgress) {
    return (
      <div style={{ background: "#FAF8F4", minHeight: "100vh" }} className="flex items-center justify-center">
        <div style={{ color: "#2B2250" }} className="font-bold">Loading...</div>
      </div>
    );
  }

  const readingMastered = Object.values(readingProgress).reduce((s, p) => s + (p.mastered ? p.mastered.length : 0), 0);
  const readingTotal = Object.values(WORD_LISTS).reduce((s, l) => s + l.length, 0);
  const mathMastered = Object.values(mathProgress).reduce((s, p) => s + (p.mastered ? p.mastered.length : 0), 0);
  const mathTotal = Object.values(FACTS).reduce((s, l) => s + l.length, 0);
  const upperSubjectTotals = Object.keys(UPPER_SUBJECTS).map((key) => ({
    key, label: UPPER_SUBJECTS[key].label, color: UPPER_SUBJECTS[key].color,
    mastered: upperMasteredForSubject(key, upperProgress), total: upperTotalForSubject(key),
  }));
  const upperMastered = upperSubjectTotals.reduce((s, u) => s + u.mastered, 0);
  const upperTotal = upperSubjectTotals.reduce((s, u) => s + u.total, 0);

  return (
    <div className="min-h-screen" style={{ background: "#FAF8F4" }}>
      <div className="flex items-center justify-between px-4 py-3 sm:px-6" style={{ borderBottom: "2px solid #EEE6D6" }}>
        <button onClick={onExit} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#2B2250", background: "#EEE6D6" }}>
          <Home size={16} /> Home
        </button>
        <div className="font-black text-lg" style={{ color: "#2B2250" }}>Overall Progress</div>
        <div style={{ width: 76 }} />
      </div>

      <div className="max-w-md mx-auto px-5 pt-6 pb-10">
        {streakData && (
          <div className="rounded-2xl p-4 mb-5 flex items-center gap-4" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: "#E8B84B22" }}>
              <Flame size={22} style={{ color: "#D98551" }} />
            </div>
            <div>
              <div className="font-black text-sm" style={{ color: "#2B2250" }}>{streakData.currentStreak} day{streakData.currentStreak === 1 ? "" : "s"} in a row</div>
              <div className="text-xs" style={{ color: "#8B8499" }}>Best streak: {streakData.longestStreak} day{streakData.longestStreak === 1 ? "" : "s"}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2.5 mb-6">
          <div className="rounded-2xl p-3" style={{ background: "#fff", border: "2px solid #D98551" }}>
            <BookOpen size={18} style={{ color: "#D98551" }} className="mb-2" />
            <div className="font-black text-base" style={{ color: "#2B2250" }}>{readingMastered}/{readingTotal}</div>
            <div className="text-[10px] font-bold" style={{ color: "#8B8499" }}>Words mastered</div>
          </div>
          <div className="rounded-2xl p-3" style={{ background: "#fff", border: "2px solid #2F4FB2" }}>
            <Calculator size={18} style={{ color: "#2F4FB2" }} className="mb-2" />
            <div className="font-black text-base" style={{ color: "#2B2250" }}>{mathMastered}/{mathTotal}</div>
            <div className="text-[10px] font-bold" style={{ color: "#8B8499" }}>Facts mastered</div>
          </div>
          <div className="rounded-2xl p-3" style={{ background: "#fff", border: "2px solid #3D6E96" }}>
            <BookMarked size={18} style={{ color: "#3D6E96" }} className="mb-2" />
            <div className="font-black text-base" style={{ color: "#2B2250" }}>{upperMastered}/{upperTotal}</div>
            <div className="text-[10px] font-bold" style={{ color: "#8B8499" }}>Upper practiced</div>
          </div>
        </div>

        <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
          <div className="font-black text-sm mb-2" style={{ color: "#2B2250" }}>Badges</div>
          <BadgeRow badges={computeBadges(
            { combo: { mastered: [...Array(readingMastered + mathMastered + upperMastered).keys()] } },
            streakData ? streakData.currentStreak : 0
          )} />
        </div>

        <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: "2px solid #D98551" }}>
          <div className="font-black text-sm mb-3" style={{ color: "#D98551" }}>Reading by Grade</div>
          {Object.keys(WORD_LISTS).map((g) => {
            const total = WORD_LISTS[g].length;
            const mastered = (readingProgress[g]?.mastered || []).length;
            return (
              <div key={g} className="mb-2 last:mb-0">
                <div className="flex justify-between text-xs font-bold mb-1" style={{ color: "#2B2250" }}>
                  <span>{GRADE_LABEL[g]}</span><span>{mastered}/{total}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#EEE6D6" }}>
                  <div className="h-full rounded-full" style={{ width: `${(mastered / total) * 100}%`, background: GRADE_COLOR[g] }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: "2px solid #2F4FB2" }}>
          <div className="font-black text-sm mb-3" style={{ color: "#2F4FB2" }}>Math by Grade</div>
          {Object.keys(MATH_GRADE_LABEL).map((g) => {
            const total = FACTS[g].length;
            const mastered = (mathProgress[g]?.mastered || []).length;
            return (
              <div key={g} className="mb-2 last:mb-0">
                <div className="flex justify-between text-xs font-bold mb-1" style={{ color: "#1B2430" }}>
                  <span>{MATH_GRADE_LABEL[g]}</span><span>{mastered}/{total}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#E7ECFA" }}>
                  <div className="h-full rounded-full" style={{ width: `${(mastered / total) * 100}%`, background: MATH_GRADE_COLOR[g] }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl p-4" style={{ background: "#fff", border: "2px solid #3D6E96" }}>
          <div className="font-black text-sm mb-3" style={{ color: "#3D6E96" }}>Upper Grades by Subject</div>
          {upperSubjectTotals.map((u) => (
            <div key={u.key} className="mb-2 last:mb-0">
              <div className="flex justify-between text-xs font-bold mb-1" style={{ color: "#2B2250" }}>
                <span>{u.label}</span><span>{u.mastered}/{u.total}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#EEE6D6" }}>
                <div className="h-full rounded-full" style={{ width: `${u.total ? (u.mastered / u.total) * 100 : 0}%`, background: u.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ===================== BACKUP / RESTORE =====================
const WA_BACKUP_KEYS = [
  STORAGE_KEY, MISSED_KEY, ACTIVITY_KEY, LAST_ACTIVITY_KEY, WEEKLY_NOTE_KEY,
  MATH_STORAGE_KEY, MATH_MISSED_KEY, MATH_ACTIVITY_KEY, MATH_LAST_ACTIVITY_KEY,
  STREAK_KEY, SPURTS_KEY, ANALYTICS_KEY, SETTINGS_KEY,
];

async function waExportBackup() {
  const data = {};
  for (const key of WA_BACKUP_KEYS) {
    if (!key) continue;
    try {
      const res = await window.storage.get(key);
      if (res && res.value) data[key] = res.value;
    } catch (e) {}
  }
  // Also sweep upper-grades keys, which are per-subject/grade and not fixed strings.
  try {
    const listed = await window.storage.list("upper:");
    if (listed && listed.keys) {
      for (const key of listed.keys) {
        try {
          const res = await window.storage.get(key);
          if (res && res.value) data[key] = res.value;
        } catch (e) {}
      }
    }
  } catch (e) {}
  return { exportedAt: new Date().toISOString(), data };
}

async function waImportBackup(payload) {
  if (!payload || !payload.data) return false;
  for (const key of Object.keys(payload.data)) {
    try { await window.storage.set(key, payload.data[key]); } catch (e) {}
  }
  return true;
}

function WABackupPanel({ onClose }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const fileRef = useRef(null);

  async function handleExport() {
    setBusy(true);
    setMessage(null);
    try {
      const backup = await waExportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `word-adventure-backup-${todayStr()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage({ type: "ok", text: "Backup downloaded." });
    } catch (e) {
      setMessage({ type: "err", text: "Couldn't create the backup — try again." });
    }
    setBusy(false);
  }

  function handleImportClick() { fileRef.current?.click(); }

  async function handleFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const ok = await waImportBackup(payload);
      setMessage(ok ? { type: "ok", text: "Backup restored! Reload the app to see it." } : { type: "err", text: "That file didn't look like a valid backup." });
    } catch (e) {
      setMessage({ type: "err", text: "Couldn't read that file — make sure it's a backup exported from this app." });
    }
    setBusy(false);
    e.target.value = "";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0" style={{ background: "rgba(43,34,80,0.5)" }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: "#fff" }} onClick={(e) => e.stopPropagation()}>
        <div className="font-black text-lg mb-1" style={{ color: "#2B2250" }}>Backup & Restore</div>
        <p className="text-xs mb-4" style={{ color: "#8B8499" }}>Save all progress, badges, and settings to a file, or restore from a previous backup.</p>

        <button onClick={handleExport} disabled={busy} className="kbtn w-full py-3 rounded-xl font-black text-white mb-2.5 flex items-center justify-center gap-2" style={{ background: "#2B2250", opacity: busy ? 0.6 : 1 }}>
          <FileText size={16} /> Download Backup
        </button>
        <button onClick={handleImportClick} disabled={busy} className="kbtn w-full py-3 rounded-xl font-black mb-3 flex items-center justify-center gap-2" style={{ background: "#EEE6D6", color: "#2B2250", opacity: busy ? 0.6 : 1 }}>
          <RotateCcw size={16} /> Restore From File
        </button>
        <input ref={fileRef} type="file" accept="application/json" onChange={handleFileChosen} style={{ display: "none" }} />

        {message && (
          <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: message.type === "ok" ? "#6FAE8B22" : "#D9432F22", color: message.type === "ok" ? "#4F8A6B" : "#D9432F" }}>
            {message.text}
          </div>
        )}

        <button onClick={onClose} className="kbtn w-full py-2.5 rounded-xl font-bold text-sm" style={{ color: "#8B8499" }}>Close</button>
      </div>
    </div>
  );
}

// ===================== UPPER GRADES SECTION =====================
const UPPER_PROGRESS_KEY = "upper:progress";
const UPPER_MISSED_KEY = "upper:missed";
const UPPER_ACTIVITY_KEY = "upper:activity";

function upperKey(subject, grade, topicId) { return `${subject}:${grade}:${topicId}`; }
function upperMissKey(subject, grade, topicId, q) { return `${subject}:${grade}:${topicId}:${q}`; }

function UpperTopBar({ title, color, onExit, onBack }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 sm:px-6" style={{ borderBottom: "2px solid #EEE6D6" }}>
      <button onClick={onBack || onExit} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#2B2250", background: "#EEE6D6" }}>
        {onBack ? <ArrowLeft size={16} /> : <Home size={16} />} {onBack ? "Back" : "Home"}
      </button>
      <div className="font-black text-base sm:text-lg text-center px-2" style={{ color }}>{title}</div>
      <div style={{ width: 76 }} />
    </div>
  );
}

function UpperSubjectHome({ onExit, onSwitchToGrades }) {
  return (
    <div className="max-w-md mx-auto px-5 pt-8 pb-10">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onExit} className="kbtn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black" style={{ background: "#EEE6D6", color: "#2B2250" }}>
          <ArrowLeftRight size={14} /> K-2 Subjects
        </button>
      </div>
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3" style={{ background: "#3D6E96" }}>
          <BookOpen color="#fff" size={28} />
        </div>
        <h1 className="text-2xl font-black" style={{ color: "#2B2250" }}>Upper Grades</h1>
        <p className="text-sm mt-1" style={{ color: "#8B8499" }}>4th & 5th grade — pick a subject</p>
      </div>
      <div className="space-y-3">
        {Object.entries(UPPER_SUBJECTS).map(([key, s]) => (
          <button key={key} onClick={() => onSwitchToGrades(key)} className="kbtn w-full rounded-2xl p-4 flex items-center gap-4 text-left" style={{ background: "#fff", border: `2px solid ${s.color}` }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${s.color}22`, color: s.color }}>
              <BookMarked size={20} />
            </div>
            <div className="flex-1">
              <div className="font-black text-base" style={{ color: "#2B2250" }}>{s.label}</div>
              <div className="text-xs" style={{ color: "#8B8499" }}>{s.tagline}</div>
            </div>
            <ArrowRight size={18} style={{ color: "#C9C2D6" }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function UpperTopicList({ subject, grade, onOpenTopic, onExit, onModeSelect, progress, missedCount }) {
  const s = UPPER_SUBJECTS[subject];
  const topics = UPPER_CONTENT[subject][grade];
  return (
    <div className="max-w-md mx-auto pb-10">
      <UpperTopBar title={`${s.label} · ${UPPER_GRADE_LABEL[grade]}`} color={s.color} onExit={onExit} />
      <div className="px-5 pt-5">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button onClick={() => onModeSelect("test")} className="kbtn rounded-xl py-3 flex flex-col items-center gap-1 font-black text-xs" style={{ background: `${s.color}14`, color: s.color, border: `2px solid ${s.color}` }}>
            <ClipboardCheck size={18} /> Full Test
          </button>
          <button onClick={() => onModeSelect("speed")} className="kbtn rounded-xl py-3 flex flex-col items-center gap-1 font-black text-xs" style={{ background: `${s.color}14`, color: s.color, border: `2px solid ${s.color}` }}>
            <Clock size={18} /> Speed Round
          </button>
          <button onClick={() => onModeSelect("balloons")} className="kbtn rounded-xl py-3 flex flex-col items-center gap-1 font-black text-xs" style={{ background: `${s.color}14`, color: s.color, border: `2px solid ${s.color}` }}>
            <Sparkles size={18} /> Balloon Pop
          </button>
          <button onClick={() => onModeSelect("memory")} className="kbtn rounded-xl py-3 flex flex-col items-center gap-1 font-black text-xs" style={{ background: `${s.color}14`, color: s.color, border: `2px solid ${s.color}` }}>
            <LayoutGrid size={18} /> Memory Match
          </button>
        </div>

        {missedCount > 0 && (
          <button onClick={() => onModeSelect("needsPractice")} className="kbtn w-full rounded-xl py-3 mb-5 flex items-center justify-center gap-2 font-black text-xs text-white" style={{ background: "#8E5A6B" }}>
            <RotateCcw size={16} /> Needs Practice ({missedCount})
          </button>
        )}
        {missedCount === 0 && <div className="mb-5" />}

        <div className="text-xs font-black uppercase tracking-widest mb-2.5" style={{ color: "#8B8499" }}>Lessons</div>
        <div className="space-y-2.5">
          {topics.map((t) => {
            const doneCount = (progress[upperKey(subject, grade, t.id)] || []).length;
            return (
              <button key={t.id} onClick={() => onOpenTopic(t)} className="kbtn w-full rounded-2xl p-4 flex items-center gap-3 text-left" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${s.color}22`, color: s.color }}>
                  <Pencil size={16} />
                </div>
                <div className="flex-1">
                  <div className="font-black text-sm" style={{ color: "#2B2250" }}>{t.title}</div>
                  <div className="text-xs" style={{ color: "#8B8499" }}>{doneCount > 0 ? `${doneCount}/${t.cards.length} practiced` : `${t.cards.length} practice cards`}</div>
                </div>
                <ArrowRight size={16} style={{ color: "#C9C2D6" }} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UpperLesson({ subject, grade, topic, onBack, onExit, onDonePractice }) {
  const s = UPPER_SUBJECTS[subject];
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    const history = nextMessages.map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`).join("\n");
    const prompt = `You are a warm, encouraging tutor helping a ${UPPER_GRADE_LABEL[grade]} student understand this lesson:\n\nTopic: ${topic.title}\nLesson: ${topic.lesson}\n\nConversation so far:\n${history}\n\nRespond to the student's latest message. Keep your answer short (2-4 sentences), clear, age-appropriate, and encouraging. If they ask something unrelated to this lesson or off-topic, gently redirect them back to ${topic.title}.`;
    const reply = await askClaude(prompt, 400);
    setLoading(false);
    setMessages((m) => [...m, { role: "assistant", content: reply || "Sorry, I couldn't think of an answer just now — try asking again." }]);
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <UpperTopBar title={topic.title} color={s.color} onExit={onExit} onBack={onBack} />
      <div className="px-5 pt-5">
        <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff", border: `2px solid ${s.color}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="font-black text-xs uppercase tracking-widest" style={{ color: s.color }}>Lesson</div>
            <button onClick={() => speak(topic.lesson, 0.95)} className="kbtn w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `${s.color}22`, color: s.color }}>
              <Volume2 size={14} />
            </button>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "#2B2250" }}>{topic.lesson}</p>
        </div>

        {!chatOpen ? (
          <button onClick={() => setChatOpen(true)} className="kbtn w-full rounded-2xl p-4 mb-5 flex items-center gap-3 text-left" style={{ background: "#2B2250" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
              <MessageCircle size={18} color="#fff" />
            </div>
            <div className="flex-1">
              <div className="text-white font-black text-sm">Ask the Tutor</div>
              <div className="text-xs" style={{ color: "#C9C2D6" }}>Confused? Ask a question about this lesson</div>
            </div>
          </button>
        ) : (
          <div className="rounded-2xl mb-5 overflow-hidden" style={{ background: "#fff", border: `2px solid ${s.color}` }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: `${s.color}14` }}>
              <div className="font-black text-xs flex items-center gap-1.5" style={{ color: s.color }}><MessageCircle size={14} /> Ask the Tutor</div>
              <button onClick={() => setChatOpen(false)} className="text-xs font-bold" style={{ color: "#8B8499" }}>Hide</button>
            </div>
            <div ref={scrollRef} className="px-4 py-3 space-y-2.5 overflow-y-auto" style={{ maxHeight: 260 }}>
              {messages.length === 0 && <div className="text-xs" style={{ color: "#8B8499" }}>Ask anything about {topic.title.toLowerCase()} — no question is too small.</div>}
              {messages.map((m, i) => (
                <div key={i} className={`text-sm rounded-xl px-3 py-2 max-w-[85%] ${m.role === "user" ? "ml-auto" : ""}`}
                  style={{ background: m.role === "user" ? s.color : "#F5F5F0", color: m.role === "user" ? "#fff" : "#2B2250" }}>
                  {m.content}
                </div>
              ))}
              {loading && <div className="text-xs" style={{ color: "#8B8499" }}>Thinking...</div>}
            </div>
            <div className="px-3 py-2.5 flex gap-2" style={{ borderTop: "1px solid #EEE6D6" }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Ask a question..." className="flex-1 text-sm px-3 py-2 rounded-lg outline-none" style={{ border: "1.5px solid #EEE6D6", color: "#2B2250" }} />
              <button onClick={sendMessage} disabled={!input.trim() || loading} className="kbtn w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: s.color, opacity: input.trim() && !loading ? 1 : 0.5 }}>
                <Send size={14} color="#fff" />
              </button>
            </div>
          </div>
        )}

        <button onClick={onDonePractice} className="kbtn w-full py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: s.color }}>
          Practice This Topic <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

function UpperPractice({ subject, grade, topic, onBack, onExit, onComplete, onMiss }) {
  const s = UPPER_SUBJECTS[subject];
  const [questions] = useState(() => buildUpperQuestions(topic.cards.map((c) => ({ ...c, topicId: topic.id })), Math.min(6, topic.cards.length)));
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [checked, setChecked] = useState(false);
  const [tip, setTip] = useState(null);
  const [tipLoading, setTipLoading] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const q = questions[idx];

  async function getWhyWrongTip() {
    setTipLoading(true);
    const prompt = `A ${UPPER_GRADE_LABEL[grade]} student was asked: "${q.q}" (topic: ${topic.title}). They answered "${q.options[picked]}" but the correct answer is "${q.a}". In 1-2 short, encouraging sentences spoken directly to the student, explain why their answer isn't quite right and give a quick way to remember the correct idea.`;
    const reply = await askClaude(prompt, 220);
    setTipLoading(false);
    setTip(reply || "Take another look at the lesson above — you're close!");
  }

  function choose(i) {
    if (checked) return;
    setPicked(i);
  }
  function check() {
    if (picked === null) return;
    setChecked(true);
    setTip(null);
    const correct = picked === q.correctIndex;
    recordActivity(UPPER_ACTIVITY_KEY, correct);
    if (correct) {
      setCorrectCount((c) => c + 1);
      playChime(true);
    } else {
      playChime(false);
      logMiss(`upper-${subject}`, grade, q.q.length > 40 ? q.q.slice(0, 40) + "..." : q.q);
      if (onMiss) onMiss(topic.id, q.q, q.a);
    }
  }
  function next() {
    if (idx + 1 < questions.length) {
      setIdx(idx + 1);
      setPicked(null);
      setChecked(false);
      setTip(null);
    } else {
      onComplete({ correct: correctCount, total: questions.length });
    }
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <UpperTopBar title={`Practice · ${topic.title}`} color={s.color} onExit={onExit} onBack={onBack} />
      <div className="px-5 pt-6">
        <div className="text-xs font-bold mb-4 text-center" style={{ color: "#8B8499" }}>Question {idx + 1} of {questions.length}</div>
        <div className="rounded-2xl p-5 mb-4" style={{ background: "#fff", border: `2px solid ${s.color}` }}>
          <div className="font-black text-base" style={{ color: "#2B2250" }}>{q.q}</div>
        </div>
        <div className="space-y-2 mb-4">
          {q.options.map((opt, i) => {
            const isPicked = picked === i;
            const isCorrect = i === q.correctIndex;
            let bg = "#fff", border = "#EEE6D6", text = "#2B2250";
            if (checked && isCorrect) { bg = "#6FAE8B22"; border = "#6FAE8B"; }
            else if (checked && isPicked && !isCorrect) { bg = "#D9432F22"; border = "#D9432F"; }
            else if (isPicked) { border = s.color; }
            return (
              <button key={i} onClick={() => choose(i)} className="kbtn w-full text-left px-4 py-3 rounded-xl font-bold text-sm" style={{ background: bg, border: `2px solid ${border}`, color: text }}>
                {opt}
              </button>
            );
          })}
        </div>

        {checked && picked !== q.correctIndex && (
          <div className="mb-4">
            {!tip && !tipLoading && (
              <button onClick={getWhyWrongTip} className="kbtn inline-flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-full" style={{ background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}` }}>
                <Sparkles size={12} /> Why was this wrong?
              </button>
            )}
            {tipLoading && <div className="text-xs" style={{ color: "#8B8499" }}>Thinking...</div>}
            {tip && <div className="text-sm mt-2 p-3 rounded-xl" style={{ background: `${s.color}14`, color: "#2B2250" }}>{tip}</div>}
          </div>
        )}

        {!checked ? (
          <button onClick={check} disabled={picked === null} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: s.color, opacity: picked === null ? 0.5 : 1 }}>Check Answer</button>
        ) : (
          <button onClick={next} className="kbtn w-full py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: s.color }}>
            {idx + 1 < questions.length ? "Next Question" : "Finish"} <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function UpperTest({ subject, grade, onBack, onExit, onFinish, onMiss }) {
  const s = UPPER_SUBJECTS[subject];
  const [questions] = useState(() => buildUpperQuestions(upperCards(subject, grade), 12));
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [picked, setPicked] = useState(null);
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(false);
  const q = questions[idx];

  function choose(i) { if (!checked) setPicked(i); }
  function check() {
    if (picked === null) return;
    setChecked(true);
    const correct = picked === q.correctIndex;
    playChime(correct);
    recordActivity(UPPER_ACTIVITY_KEY, correct);
    if (!correct) {
      logMiss(`upper-${subject}`, grade, q.q.length > 40 ? q.q.slice(0, 40) + "..." : q.q);
      if (onMiss) onMiss(q.topicId, q.q, q.a);
    }
    setAnswers((a) => [...a, { q: q.q, picked: q.options[picked], answer: q.a, correct }]);
  }
  function next() {
    setPicked(null);
    setChecked(false);
    if (idx + 1 < questions.length) setIdx(idx + 1);
    else {
      const score = answers.filter((a) => a.correct).length;
      logTest(`upper-${subject}`, grade, score, questions.length);
      onFinish({ score, total: questions.length });
      setDone(true);
    }
  }

  if (done) {
    const score = answers.filter((a) => a.correct).length;
    return (
      <div className="max-w-md mx-auto pb-10">
        <UpperTopBar title="Test Complete" color={s.color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <Trophy size={52} style={{ color: "#E8B84B" }} className="mx-auto mb-3" />
          <h2 className="text-2xl font-black mb-1" style={{ color: "#2B2250" }}>{score} / {answers.length} correct</h2>
          <p className="text-sm mb-6" style={{ color: "#8B8499" }}>{score === answers.length ? "Perfect score!" : "Great effort — review below."}</p>
          <div className="text-left rounded-2xl p-4 mb-6" style={{ background: "#fff", border: "2px solid #EEE6D6" }}>
            {answers.map((a, i) => (
              <div key={i} className="py-2 text-sm" style={{ borderBottom: i < answers.length - 1 ? "1px solid #EEE6D6" : "none" }}>
                <div className="font-bold mb-0.5" style={{ color: "#2B2250" }}>{a.q}</div>
                {a.correct ? (
                  <span className="font-bold flex items-center gap-1.5 text-xs" style={{ color: "#6FAE8B" }}><CheckCircle2 size={12} /> {a.answer}</span>
                ) : (
                  <span className="text-xs flex items-center flex-wrap gap-x-1.5" style={{ color: "#8B8499" }}>
                    <span style={{ color: "#D9432F" }}>{a.picked}</span> → <span className="font-black" style={{ color: "#2B2250" }}>{a.answer}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
          <button onClick={onExit} className="kbtn w-full py-3 rounded-xl font-black" style={{ background: "#EEE6D6", color: "#2B2250" }}><Home size={16} className="inline mr-1.5" /> Home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <UpperTopBar title={`Full Test · ${UPPER_GRADE_LABEL[grade]}`} color={s.color} onExit={onExit} onBack={onBack} />
      <div className="px-5 pt-6">
        <div className="text-xs font-bold mb-4 text-center" style={{ color: "#8B8499" }}>Question {idx + 1} of {questions.length}</div>
        <div className="rounded-2xl p-5 mb-4" style={{ background: "#fff", border: `2px solid ${s.color}` }}>
          <div className="font-black text-base" style={{ color: "#2B2250" }}>{q.q}</div>
        </div>
        <div className="space-y-2 mb-4">
          {q.options.map((opt, i) => {
            const isPicked = picked === i;
            const isCorrect = i === q.correctIndex;
            let bg = "#fff", border = "#EEE6D6";
            if (checked && isCorrect) { bg = "#6FAE8B22"; border = "#6FAE8B"; }
            else if (checked && isPicked && !isCorrect) { bg = "#D9432F22"; border = "#D9432F"; }
            else if (isPicked) { border = s.color; }
            return (
              <button key={i} onClick={() => choose(i)} className="kbtn w-full text-left px-4 py-3 rounded-xl font-bold text-sm" style={{ background: bg, border: `2px solid ${border}`, color: "#2B2250" }}>
                {opt}
              </button>
            );
          })}
        </div>
        {!checked ? (
          <button onClick={check} disabled={picked === null} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: s.color, opacity: picked === null ? 0.5 : 1 }}>Check Answer</button>
        ) : (
          <button onClick={next} className="kbtn w-full py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: s.color }}>
            {idx + 1 < questions.length ? "Next" : "Finish"} <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function UpperSpeedRound({ subject, grade, onBack, onExit }) {
  const s = UPPER_SUBJECTS[subject];
  const ROUND = 60;
  const [phase, setPhase] = useState("intro");
  const [timeLeft, setTimeLeft] = useState(ROUND);
  const [score, setScore] = useState(0);
  const [q, setQ] = useState(null);
  const [picked, setPicked] = useState(null);
  const queueRef = useRef([]);

  function nextQuestion() {
    if (queueRef.current.length === 0) queueRef.current = buildUpperQuestions(upperCards(subject, grade), upperCards(subject, grade).length);
    setQ(queueRef.current.shift());
    setPicked(null);
  }

  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => setTimeLeft((t) => { if (t <= 1) { setPhase("done"); return 0; } return t - 1; }), 1000);
    return () => clearInterval(id);
  }, [phase]);

  function start() { setScore(0); setTimeLeft(ROUND); setPhase("playing"); nextQuestion(); }

  function choose(i) {
    if (picked !== null) return;
    setPicked(i);
    const correct = i === q.correctIndex;
    playChime(correct);
    recordActivity(UPPER_ACTIVITY_KEY, correct);
    if (correct) setScore((sc) => sc + 1);
    setTimeout(nextQuestion, 500);
  }

  if (phase === "intro") {
    return (
      <div className="max-w-md mx-auto pb-10">
        <UpperTopBar title="Speed Round" color={s.color} onExit={onExit} onBack={onBack} />
        <div className="px-5 pt-8 text-center">
          <Clock size={48} style={{ color: s.color }} className="mx-auto mb-4" />
          <h2 className="text-xl font-black mb-2" style={{ color: "#2B2250" }}>60 seconds — how many can you get?</h2>
          <p className="text-sm mb-6" style={{ color: "#8B8499" }}>Answer as many questions as you can before time runs out.</p>
          <button onClick={start} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: s.color }}>Start</button>
        </div>
      </div>
    );
  }
  if (phase === "done") {
    return (
      <div className="max-w-md mx-auto pb-10">
        <UpperTopBar title="Time's Up!" color={s.color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <Trophy size={52} style={{ color: "#E8B84B" }} className="mx-auto mb-3" />
          <h2 className="text-2xl font-black mb-4" style={{ color: "#2B2250" }}>{score} correct!</h2>
          <div className="flex gap-2">
            <button onClick={onExit} className="kbtn flex-1 py-3 rounded-xl font-black" style={{ background: "#EEE6D6", color: "#2B2250" }}>Home</button>
            <button onClick={start} className="kbtn flex-1 py-3 rounded-xl font-black text-white" style={{ background: s.color }}>Play Again</button>
          </div>
        </div>
      </div>
    );
  }
  if (!q) return null;
  return (
    <div className="max-w-md mx-auto pb-10">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "2px solid #EEE6D6" }}>
        <div className="text-xs font-black" style={{ color: "#2B2250" }}>Score: {score}</div>
        <div className="text-xs font-black" style={{ color: "#D98551" }}>⏱ {timeLeft}s</div>
      </div>
      <div className="px-5 pt-6">
        <div className="rounded-2xl p-5 mb-4" style={{ background: "#fff", border: `2px solid ${s.color}` }}>
          <div className="font-black text-base" style={{ color: "#2B2250" }}>{q.q}</div>
        </div>
        <div className="space-y-2">
          {q.options.map((opt, i) => {
            let bg = "#fff", border = "#EEE6D6";
            if (picked !== null && i === q.correctIndex) { bg = "#6FAE8B22"; border = "#6FAE8B"; }
            else if (picked === i) { bg = "#D9432F22"; border = "#D9432F"; }
            return (
              <button key={i} onClick={() => choose(i)} className="kbtn w-full text-left px-4 py-3 rounded-xl font-bold text-sm" style={{ background: bg, border: `2px solid ${border}`, color: "#2B2250" }}>
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UpperBalloonPop({ subject, grade, onBack, onExit }) {
  const s = UPPER_SUBJECTS[subject];
  const calm = getCalmMode();
  const ROUND = calm ? 65 : 45;
  const cardsAll = upperCards(subject, grade);
  const queueRef = useRef([]);
  const [phase, setPhase] = useState("intro");
  const [timeLeft, setTimeLeft] = useState(ROUND);
  const [score, setScore] = useState(0);
  const [target, setTarget] = useState(cardsAll[0]);
  const [balloons, setBalloons] = useState([]);
  const balloonId = useRef(0);
  const targetRef = useRef(cardsAll[0]);

  useEffect(() => { targetRef.current = target; }, [target]);

  function takeOne() {
    if (queueRef.current.length === 0) queueRef.current = shuffle(cardsAll);
    return queueRef.current.shift();
  }

  useEffect(() => {
    if (phase !== "playing") return;
    const timerId = setInterval(() => setTimeLeft((t) => { if (t <= 1) { setPhase("done"); return 0; } return t - 1; }), 1000);
    const spawnId = setInterval(spawnBalloon, calm ? 1900 : 1300);
    return () => { clearInterval(timerId); clearInterval(spawnId); };
  }, [phase]); // eslint-disable-line

  function spawnBalloon() {
    const id = balloonId.current++;
    const useTarget = Math.random() < 0.35;
    const card = useTarget ? targetRef.current : cardsAll[Math.floor(Math.random() * cardsAll.length)];
    const left = 8 + Math.random() * 78;
    const duration = calm ? 10 + Math.random() * 3 : 7 + Math.random() * 2.5;
    setBalloons((b) => [...b, { id, answer: card.a, left, duration, col: s.color }]);
    setTimeout(() => setBalloons((b) => b.filter((bal) => bal.id !== id)), duration * 1000 + 50);
  }

  function start() { setScore(0); setTimeLeft(ROUND); setBalloons([]); setTarget(takeOne()); setPhase("playing"); }

  function pop(id, answer) {
    if (answer !== target.a) return;
    setScore((sc) => sc + 1);
    setBalloons((b) => b.filter((bal) => bal.id !== id));
    playChime(true);
    recordActivity(UPPER_ACTIVITY_KEY, true);
    setTarget(takeOne());
  }

  if (phase === "intro") {
    return (
      <div className="max-w-md mx-auto pb-10">
        <UpperTopBar title="Balloon Pop" color={s.color} onExit={onExit} onBack={onBack} />
        <div className="px-5 pt-8 text-center">
          <div className="text-5xl mb-4">🎈</div>
          <h2 className="text-xl font-black mb-2" style={{ color: "#2B2250" }}>Pop the balloon with the right answer!</h2>
          <button onClick={start} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: s.color }}>Start Game</button>
        </div>
      </div>
    );
  }
  if (phase === "done") {
    return (
      <div className="max-w-md mx-auto pb-10">
        <UpperTopBar title="Game Over" color={s.color} onExit={onExit} />
        <div className="px-5 pt-8 text-center">
          <Trophy size={52} style={{ color: s.color }} className="mx-auto mb-3" />
          <h2 className="text-2xl font-black mb-4" style={{ color: "#2B2250" }}>{score} balloons popped!</h2>
          <div className="flex gap-2">
            <button onClick={onExit} className="kbtn flex-1 py-3 rounded-xl font-black" style={{ background: "#EEE6D6", color: "#2B2250" }}>Home</button>
            <button onClick={start} className="kbtn flex-1 py-3 rounded-xl font-black text-white" style={{ background: s.color }}>Play Again</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "#FAF8F4", height: "100dvh" }}>
      <style>{`@keyframes floatUp { from { bottom: -12%; } to { bottom: 105%; } }`}</style>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "2px solid #EEE6D6" }}>
        <button onClick={onExit} className="kbtn flex items-center gap-1.5 font-bold text-sm px-3 py-2 rounded-full" style={{ color: "#2B2250", background: "#EEE6D6" }}><Home size={16} /> Home</button>
        <div className="text-xs font-black" style={{ color: "#2B2250" }}>Score: {score}</div>
        <div className="text-xs font-black" style={{ color: "#D98551" }}>⏱ {timeLeft}s</div>
      </div>
      <div className="mx-4 mt-3 rounded-2xl py-3 px-4 shrink-0" style={{ background: "#2B2250" }}>
        <div className="text-white font-black text-sm">{target.q}</div>
      </div>
      <div className="flex-1 relative overflow-hidden mx-2 mt-2 mb-2 rounded-2xl" style={{ background: `linear-gradient(180deg, ${s.color}11, #FAF8F4)` }}>
        {balloons.map((b) => (
          <button key={b.id} onClick={() => pop(b.id, b.answer)} className="absolute flex flex-col items-center"
            style={{ left: `${b.left}%`, animation: `floatUp ${b.duration}s linear forwards`, transform: "translateX(-50%)" }}>
            <div className="rounded-full flex items-center justify-center font-black px-3 shadow-md text-center"
              style={{ width: Math.max(90, Math.min(150, String(b.answer).length * 8 + 40)), height: 90, fontSize: 12, background: b.col, color: "#fff", borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%" }}>
              {b.answer}
            </div>
            <div style={{ width: 2, height: 14, background: "#C9C2D6" }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function UpperMemoryMatch({ subject, grade, onBack, onExit }) {
  const s = UPPER_SUBJECTS[subject];
  const PAIRS = 6;
  const allCards = upperCards(subject, grade);
  const queueRef = useRef([]);
  const [cards, setCards] = useState(() => buildDeck());
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const busyRef = useRef(false);

  function takeChunk(n) {
    const out = [];
    while (out.length < n) {
      if (queueRef.current.length === 0) queueRef.current = shuffle(allCards);
      out.push(queueRef.current.shift());
    }
    return out;
  }
  function buildDeck() {
    const picks = takeChunk(PAIRS);
    const deck = [];
    picks.forEach((c, i) => {
      deck.push({ id: `${i}q`, label: c.q.length > 40 ? c.q.slice(0, 37) + "..." : c.q, value: c.a, type: "q" });
      deck.push({ id: `${i}a`, label: c.a, value: c.a, type: "a" });
    });
    return shuffle(deck);
  }
  function newRound() { setCards(buildDeck()); setFlipped([]); setMatched([]); setMoves(0); busyRef.current = false; }

  function tapCard(idx) {
    if (busyRef.current || flipped.includes(idx) || matched.includes(idx)) return;
    const nextFlipped = [...flipped, idx];
    setFlipped(nextFlipped);
    if (nextFlipped.length === 2) {
      busyRef.current = true;
      setMoves((m) => m + 1);
      const [i1, i2] = nextFlipped;
      const isMatch = cards[i1].value === cards[i2].value && cards[i1].type !== cards[i2].type;
      if (isMatch) {
        setTimeout(() => { setMatched((m) => [...m, i1, i2]); setFlipped([]); busyRef.current = false; playChime(true); }, 500);
      } else {
        setTimeout(() => { setFlipped([]); busyRef.current = false; }, 1000);
      }
    }
  }
  const allMatched = matched.length === cards.length;
  return (
    <div className="max-w-md mx-auto pb-10">
      <UpperTopBar title="Memory Match" color={s.color} onExit={onExit} onBack={onBack} />
      <div className="px-5 pt-5">
        <div className="text-xs font-black mb-4 text-center" style={{ color: "#8B8499" }}>Moves: {moves}</div>
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          {cards.map((card, idx) => {
            const isFlipped = flipped.includes(idx) || matched.includes(idx);
            const isMatched = matched.includes(idx);
            return (
              <button key={card.id} onClick={() => tapCard(idx)} className="kbtn rounded-xl flex items-center justify-center text-center font-bold p-1.5"
                style={{ height: 88, background: isMatched ? "#6FAE8B22" : isFlipped ? "#fff" : s.color, border: `2.5px solid ${isMatched ? "#6FAE8B" : s.color}`, color: isMatched ? "#6FAE8B" : "#2B2250", fontSize: isFlipped ? 10 : 22, opacity: isMatched ? 0.7 : 1 }}>
                {isFlipped ? card.label : "?"}
              </button>
            );
          })}
        </div>
        {allMatched && (
          <div className="rounded-2xl p-5 text-center pop" style={{ background: "#fff", border: `2px solid ${s.color}` }}>
            <Trophy size={36} style={{ color: "#E8B84B" }} className="mx-auto mb-2" />
            <div className="font-black text-lg mb-3" style={{ color: "#2B2250" }}>All matched in {moves} moves!</div>
            <button onClick={newRound} className="kbtn w-full py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: s.color }}>Next Round <ArrowRight size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function UpperNeedsPracticeMode({ subject, pool, onSolved, onExit, onBack }) {
  const s = UPPER_SUBJECTS[subject];
  const color = "#8E5A6B";
  // Resolve each missed item back to its full card (with distractors), and
  // draw distractor options from the whole subject so choices stay varied.
  const [state] = useState(() => {
    const items = pool
      .filter((m) => m.subject === subject)
      .map((m) => ({ ...m, card: findUpperCard(m.subject, m.grade, m.topicId, m.q) }))
      .filter((m) => m.card);
    const distractorPool = [...UPPER_GRADES.flatMap((g) => upperCards(subject, g))];
    const questions = buildUpperReviewQuestions(items.map((m) => m.card), distractorPool)
      .map((q, i) => ({ ...q, grade: items[i].grade }));
    return { questions };
  });
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [checked, setChecked] = useState(false);
  const q = state.questions[idx];

  if (state.questions.length === 0) {
    return (
      <div className="max-w-md mx-auto pb-10">
        <UpperTopBar title="Needs Practice" color={color} onExit={onExit} onBack={onBack} />
        <div className="px-5 pt-10 text-center">
          <CheckCircle2 size={48} style={{ color: "#6FAE8B" }} className="mx-auto mb-4" />
          <h2 className="text-xl font-black mb-2" style={{ color: "#2B2250" }}>All caught up!</h2>
          <p className="text-sm" style={{ color: "#8B8499" }}>Nothing needs review right now — great work.</p>
        </div>
      </div>
    );
  }

  function choose(i) { if (!checked) setPicked(i); }
  function check() {
    if (picked === null) return;
    setChecked(true);
    const correct = picked === q.correctIndex;
    playChime(correct);
    recordActivity(UPPER_ACTIVITY_KEY, correct);
    if (correct) onSolved(q.topicId, q.q);
  }
  function next() {
    if (idx + 1 < state.questions.length) { setIdx(idx + 1); setPicked(null); setChecked(false); }
    else onExit();
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <UpperTopBar title="Needs Practice" color={color} onExit={onExit} onBack={onBack} />
      <div className="px-5 pt-6">
        <div className="text-xs font-bold mb-4 text-center" style={{ color: "#8B8499" }}>Question {idx + 1} of {state.questions.length}</div>
        <div className="rounded-2xl p-5 mb-4" style={{ background: "#fff", border: `2px solid ${color}` }}>
          <div className="font-black text-base" style={{ color: "#2B2250" }}>{q.q}</div>
        </div>
        <div className="space-y-2 mb-4">
          {q.options.map((opt, i) => {
            const isPicked = picked === i;
            const isCorrect = i === q.correctIndex;
            let bg = "#fff", border = "#EEE6D6";
            if (checked && isCorrect) { bg = "#6FAE8B22"; border = "#6FAE8B"; }
            else if (checked && isPicked && !isCorrect) { bg = "#D9432F22"; border = "#D9432F"; }
            else if (isPicked) { border = color; }
            return (
              <button key={i} onClick={() => choose(i)} className="kbtn w-full text-left px-4 py-3 rounded-xl font-bold text-sm" style={{ background: bg, border: `2px solid ${border}`, color: "#2B2250" }}>
                {opt}
              </button>
            );
          })}
        </div>
        {!checked ? (
          <button onClick={check} disabled={picked === null} className="kbtn w-full py-3 rounded-xl font-black text-white" style={{ background: color, opacity: picked === null ? 0.5 : 1 }}>Check Answer</button>
        ) : (
          <button onClick={next} className="kbtn w-full py-3 rounded-xl font-black text-white flex items-center justify-center gap-2" style={{ background: color }}>
            {idx + 1 < state.questions.length ? "Next" : "Finish"} <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function UpperSection({ onSwitchSubject }) {
  const [subject, setSubject] = useState(null);
  const [grade, setGrade] = useState("4");
  const [view, setView] = useState("subjects"); // subjects | topics | lesson | practice | test | speed | balloons | memory
  const [activeTopic, setActiveTopic] = useState(null);
  const [progress, setProgress] = useState({});
  const [missedPool, setMissedPool] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(UPPER_PROGRESS_KEY);
        if (res && res.value) setProgress(JSON.parse(res.value));
      } catch (e) {}
      setLoaded(true);
    })();
    (async () => {
      try {
        const res = await window.storage.get(UPPER_MISSED_KEY);
        if (res && res.value) setMissedPool(JSON.parse(res.value));
      } catch (e) {}
    })();
  }, []);

  async function saveProgress(next) {
    setProgress(next);
    try { await window.storage.set(UPPER_PROGRESS_KEY, JSON.stringify(next)); } catch (e) {}
  }

  async function saveMissedPool(next) {
    setMissedPool(next);
    try { await window.storage.set(UPPER_MISSED_KEY, JSON.stringify(next)); } catch (e) {}
  }

  function addMiss(topicId, q, a) {
    setMissedPool((prev) => {
      const key = upperMissKey(subject, grade, topicId, q);
      if (prev.some((m) => upperMissKey(m.subject, m.grade, m.topicId, m.q) === key)) return prev;
      const next = [...prev, { subject, grade, topicId, q, a }];
      saveMissedPool(next);
      return next;
    });
  }
  function removeMiss(topicId, q) {
    setMissedPool((prev) => {
      const next = prev.filter((m) => !(m.subject === subject && m.topicId === topicId && m.q === q));
      saveMissedPool(next);
      return next;
    });
  }

  function markPracticed(topicId, correctCount, total) {
    const key = upperKey(subject, grade, topicId);
    const next = { ...progress, [key]: Array.from({ length: correctCount }, (_, i) => i) };
    saveProgress(next);
  }

  const missedCountForSubject = subject ? missedPool.filter((m) => m.subject === subject).length : 0;

  function openSubject(key) { setSubject(key); setView("topics"); }
  function openTopic(t) { setActiveTopic(t); setView("lesson"); }
  function goTopics() { setView("topics"); setActiveTopic(null); }
  function goSubjects() { setView("subjects"); setSubject(null); }

  if (!loaded) {
    return (
      <div style={{ background: "#FAF8F4", minHeight: "100vh" }} className="flex items-center justify-center">
        <div style={{ color: "#2B2250" }} className="font-bold">Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ background: "#FAF8F4", minHeight: "100vh", fontFamily: "'Trebuchet MS', 'Verdana', sans-serif" }}>
      <style>{`
        @keyframes popIn { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes floatUp { from { bottom: -12%; } to { bottom: 105%; } }
        .pop { animation: popIn 220ms ease-out; }
        .kbtn { transition: transform 100ms ease; }
        .kbtn:active { transform: scale(0.95); }
      `}</style>

      {view === "subjects" && (
        <>
          <div className="max-w-md mx-auto px-5 pt-5 flex justify-end gap-2">
            {UPPER_GRADES.map((g) => (
              <button key={g} onClick={() => setGrade(g)} className="kbtn px-3 py-1.5 rounded-full font-black text-xs" style={{ background: grade === g ? "#2B2250" : "#EEE6D6", color: grade === g ? "#fff" : "#2B2250" }}>
                {UPPER_GRADE_LABEL[g]}
              </button>
            ))}
          </div>
          <UpperSubjectHome onExit={onSwitchSubject} onSwitchToGrades={openSubject} />
        </>
      )}
      {view === "topics" && subject && (
        <UpperTopicList subject={subject} grade={grade} progress={progress} onOpenTopic={openTopic}
          onExit={goSubjects} onModeSelect={(m) => setView(m)} missedCount={missedCountForSubject} />
      )}
      {view === "lesson" && subject && activeTopic && (
        <UpperLesson subject={subject} grade={grade} topic={activeTopic} onBack={goTopics} onExit={goSubjects}
          onDonePractice={() => setView("practice")} />
      )}
      {view === "practice" && subject && activeTopic && (
        <UpperPractice subject={subject} grade={grade} topic={activeTopic} onBack={() => setView("lesson")} onExit={goSubjects}
          onComplete={(r) => { markPracticed(activeTopic.id, r.correct, r.total); goTopics(); }}
          onMiss={addMiss} />
      )}
      {view === "test" && subject && (
        <UpperTest subject={subject} grade={grade} onBack={goTopics} onExit={goSubjects} onFinish={() => {}} onMiss={addMiss} />
      )}
      {view === "speed" && subject && (
        <UpperSpeedRound subject={subject} grade={grade} onBack={goTopics} onExit={goSubjects} />
      )}
      {view === "balloons" && subject && (
        <UpperBalloonPop subject={subject} grade={grade} onBack={goTopics} onExit={goSubjects} />
      )}
      {view === "memory" && subject && (
        <UpperMemoryMatch subject={subject} grade={grade} onBack={goTopics} onExit={goSubjects} />
      )}
      {view === "needsPractice" && subject && (
        <UpperNeedsPracticeMode subject={subject} pool={missedPool} onSolved={removeMiss} onBack={goTopics} onExit={goSubjects} />
      )}
    </div>
  );
}

function SubjectPicker({ onSelect, onOpenReport, onOpenSettings }) {
  const [showBackup, setShowBackup] = useState(false);
  return (
    <div style={{ background: "#FAF8F4", minHeight: "100vh", fontFamily: "'Trebuchet MS', 'Verdana', sans-serif" }}>
      <div className="max-w-md mx-auto px-5 pt-10 pb-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: "#2B2250" }}>
            <Sparkles color="#fff" size={30} />
          </div>
          <h1 className="text-3xl font-black" style={{ color: "#2B2250" }}>Jase's Learning World</h1>
          <p className="text-sm mt-1.5" style={{ color: "#8B8499" }}>What should we work on today?</p>
        </div>

        <div className="space-y-3 mb-6">
          <button onClick={() => onSelect("reading")} className="kbtn w-full rounded-2xl p-5 flex items-center gap-4 text-left" style={{ background: "#fff", border: "2px solid #D98551" }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "#D9855122", color: "#D98551" }}>
              <BookOpen size={26} />
            </div>
            <div className="flex-1">
              <div className="font-black text-lg" style={{ color: "#2B2250" }}>Reading</div>
              <div className="text-xs" style={{ color: "#8B8499" }}>K-5th grade sight words, stories & more</div>
            </div>
            <ArrowRight size={20} style={{ color: "#C9C2D6" }} />
          </button>

          <button onClick={() => onSelect("math")} className="kbtn w-full rounded-2xl p-5 flex items-center gap-4 text-left" style={{ background: "#fff", border: "2px solid #2F4FB2" }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "#2F4FB222", color: "#2F4FB2" }}>
              <Calculator size={26} />
            </div>
            <div className="flex-1">
              <div className="font-black text-lg" style={{ color: "#2B2250" }}>Math</div>
              <div className="text-xs" style={{ color: "#8B8499" }}>K-5th grade facts, word problems & games</div>
            </div>
            <ArrowRight size={20} style={{ color: "#C9C2D6" }} />
          </button>

          <button onClick={() => onSelect("upper")} className="kbtn w-full rounded-2xl p-5 flex items-center gap-4 text-left" style={{ background: "#fff", border: "2px solid #3D6E96" }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "#3D6E9622", color: "#3D6E96" }}>
              <BookMarked size={26} />
            </div>
            <div className="flex-1">
              <div className="font-black text-lg" style={{ color: "#2B2250" }}>Upper Grades</div>
              <div className="text-xs" style={{ color: "#8B8499" }}>4th-5th: Math, English, Science, Social Studies</div>
            </div>
            <ArrowRight size={20} style={{ color: "#C9C2D6" }} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <button onClick={onOpenReport} className="kbtn rounded-xl py-3 flex items-center justify-center gap-2 font-black text-sm" style={{ background: "#2B2250", color: "#fff" }}>
            <BarChart3 size={16} /> Overall Progress
          </button>
          <button onClick={onOpenSettings} className="kbtn rounded-xl py-3 flex items-center justify-center gap-2 font-black text-sm" style={{ background: "#EEE6D6", color: "#2B2250" }}>
            <Pencil size={16} /> Settings
          </button>
        </div>
        <button onClick={() => setShowBackup(true)} className="kbtn w-full rounded-xl py-3 flex items-center justify-center gap-2 font-black text-sm" style={{ background: "#fff", color: "#8B8499", border: "2px solid #EEE6D6" }}>
          <FileText size={16} /> Backup & Restore
        </button>
      </div>
      {showBackup && <WABackupPanel onClose={() => setShowBackup(false)} />}
    </div>
  );
}

function CombinedApp() {
  const [subject, setSubject] = useState(null); // null | "reading" | "math" | "upper"
  const [globalView, setGlobalView] = useState(null); // null | "report" | "settings"
  const [settings, setSettings] = useState({ fontScale: "normal", dyslexiaSpacing: false, calmMode: false });
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await loadAppSettings();
      setSettings(s);
      setSettingsLoaded(true);
    })();
  }, []);

  async function updateSettings(patch) {
    const next = await saveAppSettings(patch);
    setSettings({ ...next });
  }

  function goSubjectPicker() { setSubject(null); setGlobalView(null); }

  if (!settingsLoaded) {
    return (
      <div style={{ background: "#FAF8F4", minHeight: "100vh" }} className="flex items-center justify-center">
        <div style={{ color: "#2B2250" }} className="font-bold">Loading...</div>
      </div>
    );
  }

  const fontScaleStyle = settings.fontScale === "large" ? { fontSize: "1.08em" } : {};
  const dyslexiaStyle = settings.dyslexiaSpacing ? { letterSpacing: "0.04em", wordSpacing: "0.12em" } : {};

  return (
    <div style={{ ...fontScaleStyle, ...dyslexiaStyle }}>
      {globalView === "settings" && (
        <SettingsPanel settings={settings} onChange={updateSettings} onBack={() => setGlobalView(null)} />
      )}
      {globalView === "report" && (
        <CombinedProgressReport onExit={() => setGlobalView(null)} />
      )}
      {globalView === null && subject === null && (
        <SubjectPicker
          onSelect={(s) => setSubject(s)}
          onOpenReport={() => setGlobalView("report")}
          onOpenSettings={() => setGlobalView("settings")}
        />
      )}
      {globalView === null && subject === "reading" && (
        <ReadingSection onSwitchSubject={goSubjectPicker} />
      )}
      {globalView === null && subject === "math" && (
        <MathSection onSwitchSubject={goSubjectPicker} />
      )}
      {globalView === null && subject === "upper" && (
        <UpperSection onSwitchSubject={goSubjectPicker} />
      )}
    </div>
  );
}

// ============================================================
// Accounts layer — added for the multi-family public version.
// Everything above this line is Jase's original app, unchanged
// except for the "import { supabase }" line at the very top.
//
// How this works: window.storage used to be a device-only save
// system. Now, once a parent signs in and picks a child, we swap
// window.storage for a version that saves to that child's own
// spot in the shared database instead. Every screen above keeps
// working exactly as it did before — it has no idea the storage
// underneath it changed.
// ============================================================

// Matches window.storage's original shape exactly: get() returns
// { value } (or { value: null } if nothing's saved yet), set()
// takes a string, list() returns { keys: [...] }.
function makeCloudStorage(childId) {
  return {
    async get(key) {
      try {
        const { data, error } = await supabase
          .from("app_data")
          .select("value")
          .eq("child_id", childId)
          .eq("key", key)
          .maybeSingle();
        if (error || !data) return { value: null };
        return { value: data.value };
      } catch (e) {
        return { value: null };
      }
    },
    async set(key, value) {
      try {
        const { error } = await supabase
          .from("app_data")
          .upsert(
            { child_id: childId, key, value, updated_at: new Date().toISOString() },
            { onConflict: "child_id,key" }
          );
        return !error;
      } catch (e) {
        return false;
      }
    },
    async list(prefix) {
      try {
        const { data, error } = await supabase
          .from("app_data")
          .select("key")
          .eq("child_id", childId)
          .like("key", `${prefix}%`);
        if (error || !data) return { keys: [] };
        return { keys: data.map((row) => row.key) };
      } catch (e) {
        return { keys: [] };
      }
    },
  };
}

function AccountBar({ childName, onSwitchChild, onSignOut }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2 text-sm"
      style={{ background: "#FBF4E6", borderBottom: "1px solid #E7DCC4" }}
    >
      <div className="font-bold" style={{ color: "#1B2430" }}>{childName}'s learning</div>
      <div className="flex items-center gap-3">
        <button onClick={onSwitchChild} className="underline font-semibold" style={{ color: "#6B5B95" }}>
          Switch Kid
        </button>
        <button onClick={onSignOut} className="underline font-semibold" style={{ color: "#8a8a8a" }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo("Check your email to confirm your account, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError((err && err.message) || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#FBF4E6" }}>
      <div className="w-full max-w-sm rounded-2xl p-6 shadow-lg" style={{ background: "white" }}>
        <h1 className="text-2xl font-black text-center mb-1" style={{ color: "#1B2430" }}>
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="text-center text-sm mb-6" style={{ color: "#6b6b6b" }}>
          {mode === "signup" ? "One account for the whole family." : "Sign in to see your kids' progress."}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Email" autoComplete="email"
            className="w-full px-4 py-3 rounded-xl outline-none"
            style={{ border: "2px solid #E7DCC4" }}
          />
          <input
            type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={6}
            className="w-full px-4 py-3 rounded-xl outline-none"
            style={{ border: "2px solid #E7DCC4" }}
          />
          {error && <div className="text-sm font-semibold" style={{ color: "#C0392B" }}>{error}</div>}
          {info && <div className="text-sm font-semibold" style={{ color: "#6FAE8B" }}>{info}</div>}
          <button
            type="submit" disabled={busy}
            className="w-full py-3 rounded-xl font-black text-white"
            style={{ background: "#6B5B95", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Please wait..." : mode === "signup" ? "Sign Up" : "Sign In"}
          </button>
        </form>
        <button
          onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setInfo(""); }}
          className="w-full text-center text-sm font-semibold mt-4 underline"
          style={{ color: "#6B5B95" }}
        >
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}

function ChildPicker({ familyId, onPick }) {
  const [children, setChildren] = useState(null); // null = still loading
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadChildren = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("children")
        .select("id, display_name, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      setChildren(data || []);
    } catch (err) {
      setError((err && err.message) || "Couldn't load children.");
      setChildren([]);
    }
  }, []);

  useEffect(() => { loadChildren(); }, [loadChildren]);

  async function addChild(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await supabase
        .from("children")
        .insert({ family_id: familyId, display_name: name })
        .select("id, display_name, created_at")
        .single();
      if (error) throw error;
      setNewName("");
      setChildren((prev) => [...(prev || []), data]);
    } catch (err) {
      setError((err && err.message) || "Couldn't add that child.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#FBF4E6" }}>
      <div className="w-full max-w-sm rounded-2xl p-6 shadow-lg" style={{ background: "white" }}>
        <h1 className="text-2xl font-black text-center mb-6" style={{ color: "#1B2430" }}>Who's learning today?</h1>
        {children === null ? (
          <div className="text-center" style={{ color: "#6b6b6b" }}>Loading...</div>
        ) : (
          <div className="space-y-2 mb-6">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => onPick(child)}
                className="w-full py-3 rounded-xl font-bold text-left px-4"
                style={{ background: "#FBF4E6", border: "2px solid #E7DCC4", color: "#1B2430" }}
              >
                {child.display_name}
              </button>
            ))}
            {children.length === 0 && (
              <div className="text-sm text-center" style={{ color: "#6b6b6b" }}>
                No kids added yet — add one below.
              </div>
            )}
          </div>
        )}
        <form onSubmit={addChild} className="flex gap-2">
          <input
            value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Add a child's name"
            className="flex-1 px-4 py-3 rounded-xl outline-none"
            style={{ border: "2px solid #E7DCC4" }}
          />
          <button
            type="submit" disabled={busy || !newName.trim()}
            className="px-4 py-3 rounded-xl font-black text-white"
            style={{ background: "#6B5B95", opacity: busy ? 0.6 : 1 }}
          >
            Add
          </button>
        </form>
        {error && <div className="text-sm font-semibold mt-3" style={{ color: "#C0392B" }}>{error}</div>}
        <button
          onClick={() => supabase.auth.signOut()}
          className="w-full text-center text-sm font-semibold mt-6 underline"
          style={{ color: "#8a8a8a" }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [activeChild, setActiveChild] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setActiveChild(null); // signing out (or switching accounts) always resets the picked child
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  function pickChild(child) {
    window.storage = makeCloudStorage(child.id);
    setActiveChild(child);
  }

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FBF4E6" }}>
        <div style={{ color: "#6b6b6b" }}>Loading...</div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (!activeChild) {
    return <ChildPicker familyId={session.user.id} onPick={pickChild} />;
  }

  return (
    <div>
      <AccountBar
        childName={activeChild.display_name}
        onSwitchChild={() => setActiveChild(null)}
        onSignOut={() => supabase.auth.signOut()}
      />
      <CombinedApp key={activeChild.id} />
    </div>
  );
}

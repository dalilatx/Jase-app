// Lesson videos.
//
// Videos only play from channels that teachers widely trust (checked in the
// browser when the video loads: YouTube's player reports the channel name),
// or that a grown-up added themselves. Anything else is skipped silently,
// as is any video that's been removed or can't be embedded.

export const TRUSTED_CHANNELS = [
  "Khan Academy", "Khan Academy Kids", "Math Antics", "Numberock", "Scratch Garden",
  "Jack Hartmann Kids Music Channel", "Homeschool Pop", "Crash Course", "CrashCourse",
  "Crash Course Kids", "SciShow Kids", "SciShow", "The Organic Chemistry Tutor", "Free School",
  "Learn Bright", "Rock 'N Learn", "Alphablocks", "Numberblocks", "TED-Ed", "Bozeman Science",
  "Professor Dave Explains", "National Geographic Kids", "Mr. DeMaio", "Smile and Learn - English",
  "Sesame Street", "PBS KIDS", "Peekaboo Kidz", "Brain Pop", "BrainPOP",
];

export function isTrustedChannel(author) {
  if (!author) return false;
  const a = author.trim().toLowerCase();
  return TRUSTED_CHANNELS.some((c) => c.toLowerCase() === a);
}

// Suggested videos by skill id (see skillMap.js). Each is still checked
// against TRUSTED_CHANNELS when it plays, and a grown-up can swap or hide it.
// Lessons without one here skip the video step unless a grown-up adds one.
export const VIDEO_SEEDS = {
  // Math
  "math-5-order-of-operations": "ClYdw4d4OmA", // Khan Academy: Introduction to order of operations
  // Science
  "science-9-dna-and-protein-synthesis": "8kK2zwjRV0M", // Crash Course Biology #10
  "science-9-evolution": "aTftyFboC_M", // Crash Course Biology #14: Natural Selection
  "science-9-ecology": "izRvPaAWgyw", // Crash Course Biology #40: Ecology
  "science-10-chemical-bonding": "QXT4OVM4vXI", // Crash Course Chemistry #22: Types of Chemical Bonds
  "science-10-stoichiometry": "UL1jmJaUkaQ", // Crash Course Chemistry #6: Stoichiometry
  "science-11-physics-motion": "ZM8ECpBuQYE", // Crash Course Physics #1: Motion in a Straight Line
  "science-11-forces-and-momentum": "kKKM8Y-u7ds", // Crash Course Physics #5: Newton's Laws
  "science-11-electricity-and-circuits": "HXOok3mfMLM", // Crash Course Physics #28: Electric Current
  // Social Studies
  "social-6-mesopotamia-and-egypt": "sohXPx_XZ6Y", // Crash Course World History #3: Mesopotamia
  "social-6-ancient-rome": "oPf27gAup9U", // Crash Course World History #10: The Roman Empire
  "social-8-founding-the-nation": "bO7FQsCcbD8", // Crash Course US History #8: The Constitution
  "social-8-the-civil-war": "rY9zHNOjGrs", // Crash Course US History #20: The Civil War, Part I
  "social-8-reconstruction": "nowsS7pMApI", // Crash Course US History #22: Reconstruction
  "social-10-world-war-i": "_XPZQ0LAlR4", // Crash Course World History #36: World War I
  "social-10-world-war-ii": "Q78COTwT7nE", // Crash Course World History #38: World War II
  "social-11-the-1920s-and-the-great-depression": "GCQfMWAikyU", // Crash Course US History #33
  "social-11-the-civil-rights-movement": "S64zRnnn4Po", // Crash Course US History #39
  "social-12-foundations-of-government": "lrk4oY7UxpQ", // Crash Course Government: Introduction
  "social-12-congress-the-president-and-the-courts": "0bf3CwYCxXw", // Crash Course Government #3: Checks and Balances
  "social-12-rights-and-responsibilities": "kbwsF-A2sTg", // Crash Course Government #23: Civil Rights & Liberties
};

// Accepts a YouTube link in any common form (or a bare video id).
export function parseYouTubeId(input) {
  if (!input) return null;
  const text = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function youTubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

// Placement test: finds the grade level a child can actually work at in Math
// and Reading, which may be below (or above) their grade by age.
//
// How it works (an adaptive "staircase", like the diagnostics in IXL or i-Ready):
//   - Start one grade below their grade by age.
//   - Ask that grade's 4 questions. 3+ right = passed, otherwise not yet.
//   - Passed: move up a grade. Not yet: move down. Stop when the direction
//     would flip (or at K / 12th).
//   - Working level = the grade just above the highest grade they passed.
//
// Each question: { q, options, answer (index into options), skill, say? }.
// `say` is what gets read aloud when it differs from the written question.

export const PLACEMENT_SUBJECTS = {
  math: { label: "Math", color: "#2F4FB2" },
  reading: { label: "Reading", color: "#D98551" },
};

export const PASS_SCORE = 3; // out of 4 per grade

export const PLACEMENT_ITEMS = {
  math: {
    K: [
      { q: "How many stars?  ⭐ ⭐ ⭐ ⭐ ⭐", say: "How many stars are there?", options: ["4", "5", "6"], answer: 1, skill: "Counting to 100" },
      { q: "Which number is bigger: 7 or 4?", options: ["7", "4"], answer: 0, skill: "Numbers 0-20" },
      { q: "2 + 3 = ?", say: "What is 2 plus 3?", options: ["4", "5", "6"], answer: 1, skill: "Adding Within 10" },
      { q: "Which shape has 3 sides?", options: ["Square", "Triangle", "Circle"], answer: 1, skill: "Shapes" },
    ],
    "1": [
      { q: "8 + 6 = ?", say: "What is 8 plus 6?", options: ["13", "14", "15"], answer: 1, skill: "Addition & Subtraction to 20" },
      { q: "15 − 7 = ?", say: "What is 15 minus 7?", options: ["7", "8", "9"], answer: 1, skill: "Addition & Subtraction to 20" },
      { q: "What number is 3 tens and 4 ones?", options: ["43", "34", "7"], answer: 1, skill: "Place Value: Tens & Ones" },
      { q: "Sam had 9 apples. He got 5 more. How many apples does he have now?", options: ["13", "14", "4"], answer: 1, skill: "Word Problems to 20" },
    ],
    "2": [
      { q: "46 + 37 = ?", say: "What is 46 plus 37?", options: ["73", "83", "84"], answer: 1, skill: "Add & Subtract Within 100" },
      { q: "82 − 45 = ?", say: "What is 82 minus 45?", options: ["37", "43", "47"], answer: 0, skill: "Add & Subtract Within 100" },
      { q: "How many cents are 3 quarters?", options: ["30¢", "60¢", "75¢"], answer: 2, skill: "Money" },
      { q: "There are 4 rows with 5 dots in each row. How many dots in all?", options: ["9", "20", "25"], answer: 1, skill: "Arrays & Equal Groups" },
    ],
    "3": [
      { q: "7 × 8 = ?", say: "What is 7 times 8?", options: ["54", "56", "63"], answer: 1, skill: "Multiplication Facts" },
      { q: "42 ÷ 6 = ?", say: "What is 42 divided by 6?", options: ["6", "7", "8"], answer: 1, skill: "Division Facts" },
      { q: "Which fraction is bigger: 1/3 or 1/2?", say: "Which fraction is bigger: one third or one half?", options: ["1/3", "1/2", "They are equal"], answer: 1, skill: "Fractions on a Number Line" },
      { q: "A rectangle is 4 cm long and 6 cm wide. What is its area?", options: ["10 square cm", "20 square cm", "24 square cm"], answer: 2, skill: "Area & Perimeter" },
    ],
    "4": [
      { q: "34 × 26 = ?", say: "What is 34 times 26?", options: ["784", "884", "894"], answer: 1, skill: "Multi-Digit Multiplication" },
      { q: "952 ÷ 4 = ?", say: "What is 952 divided by 4?", options: ["228", "238", "248"], answer: 1, skill: "Long Division" },
      { q: "3/4 = ?/8", say: "Three fourths equals how many eighths?", options: ["3", "4", "6"], answer: 2, skill: "Equivalent Fractions" },
      { q: "Which is larger: 0.7 or 0.65?", options: ["0.7", "0.65", "They are equal"], answer: 0, skill: "Decimals" },
    ],
    "5": [
      { q: "3 + 4 × 2 = ?", say: "What is 3 plus 4 times 2?", options: ["11", "14", "10"], answer: 0, skill: "Order of Operations" },
      { q: "1/2 + 1/3 = ?", say: "What is one half plus one third?", options: ["2/5", "5/6", "1/6"], answer: 1, skill: "Fractions with Unlike Denominators" },
      { q: "2.5 × 0.4 = ?", say: "What is 2.5 times 0.4?", options: ["1", "10", "0.1"], answer: 0, skill: "Decimal Operations" },
      { q: "A box is 3 units long, 4 units wide and 5 units tall. What is its volume?", options: ["12 cubic units", "60 cubic units", "47 cubic units"], answer: 1, skill: "Volume" },
    ],
    "6": [
      { q: "A bag has 3 red marbles for every 5 blue marbles. If there are 15 blue marbles, how many red marbles are there?", options: ["9", "10", "13"], answer: 0, skill: "Ratios & Rates" },
      { q: "2/3 ÷ 1/6 = ?", say: "What is two thirds divided by one sixth?", options: ["1/9", "4", "3"], answer: 1, skill: "Dividing Fractions" },
      { q: "Solve: x + 7 = 15", say: "Solve: x plus 7 equals 15", options: ["x = 8", "x = 22", "x = 7"], answer: 0, skill: "One-Step Equations" },
      { q: "What is the mean (average) of 4, 8, 6 and 10?", options: ["6", "7", "8"], answer: 1, skill: "Statistics Basics" },
    ],
    "7": [
      { q: "What is 20% of 45?", options: ["9", "20", "4.5"], answer: 0, skill: "Percents" },
      { q: "−6 + 10 = ?", say: "What is negative 6 plus 10?", options: ["−16", "4", "−4"], answer: 1, skill: "Integer Operations" },
      { q: "Solve: 3x − 5 = 16", say: "Solve: 3x minus 5 equals 16", options: ["x = 7", "x = 11/3", "x = 3"], answer: 0, skill: "Two-Step Equations" },
      { q: "(−4) × (−5) = ?", say: "What is negative 4 times negative 5?", options: ["−20", "20", "−9"], answer: 1, skill: "Integer Operations" },
    ],
    "8": [
      { q: "What is the slope of the line through (1, 2) and (3, 8)?", options: ["3", "6", "1/3"], answer: 0, skill: "Slope & Graphing Lines" },
      { q: "Solve: 2x + 5 = x − 3", say: "Solve: 2x plus 5 equals x minus 3", options: ["x = 8", "x = −8", "x = −2"], answer: 1, skill: "Linear Equations" },
      { q: "A right triangle has legs of 6 and 8. How long is the hypotenuse?", options: ["10", "14", "48"], answer: 0, skill: "Pythagorean Theorem" },
      { q: "3.2 × 10⁴ = ?", say: "What is 3.2 times 10 to the fourth power?", options: ["320", "3,200", "32,000"], answer: 2, skill: "Exponents & Scientific Notation" },
    ],
    "9": [
      { q: "Solve: x² − 5x + 6 = 0", say: "Solve: x squared minus 5x plus 6 equals 0", options: ["x = 2 or x = 3", "x = −2 or x = −3", "x = 1 or x = 6"], answer: 0, skill: "Quadratic Equations" },
      { q: "Factor: x² − 9", say: "Factor: x squared minus 9", options: ["(x − 3)²", "(x − 3)(x + 3)", "(x − 9)(x + 1)"], answer: 1, skill: "Factoring" },
      { q: "Simplify: (2x)(3x²)", say: "Simplify: 2x times 3x squared", options: ["6x³", "5x³", "6x²"], answer: 0, skill: "Exponents & Polynomials" },
      { q: "Which equation is the line with slope 2 that crosses the y-axis at 3?", options: ["y = 3x + 2", "y = 2x + 3", "y = 2x − 3"], answer: 1, skill: "Linear Functions" },
    ],
    "10": [
      { q: "Two angles of a triangle are 50° and 60°. What is the third angle?", options: ["70°", "80°", "90°"], answer: 0, skill: "Geometry Foundations & Proof" },
      { q: "In a right triangle, sine of an angle = opposite ÷ ?", say: "In a right triangle, the sine of an angle equals the opposite side divided by which side?", options: ["adjacent", "hypotenuse", "opposite"], answer: 1, skill: "Right Triangle Trigonometry" },
      { q: "What is the area of a circle with radius 5?", options: ["10π", "25π", "5π"], answer: 1, skill: "Circles" },
      { q: "Two triangles are similar with scale factor 2. A side of 4 in the small triangle matches which length in the big one?", options: ["6", "8", "2"], answer: 1, skill: "Similarity" },
    ],
    "11": [
      { q: "log₂ 8 = ?", say: "What is log base 2 of 8?", options: ["3", "4", "16"], answer: 0, skill: "Exponents & Logarithms" },
      { q: "i² = ?", say: "What is i squared?", options: ["1", "−1", "i"], answer: 1, skill: "Radicals & Complex Numbers" },
      { q: "What comes next: 3, 6, 12, 24, ...?", options: ["36", "48", "30"], answer: 1, skill: "Sequences & Series" },
      { q: "If f(x) = 2x + 1, what is the inverse f⁻¹(x)?", say: "If f of x equals 2x plus 1, what is the inverse function?", options: ["(x − 1)/2", "2x − 1", "1/(2x + 1)"], answer: 0, skill: "Functions & Their Graphs" },
    ],
    "12": [
      { q: "sin(90°) = ?", say: "What is the sine of 90 degrees?", options: ["0", "1", "−1"], answer: 1, skill: "Trigonometric Functions" },
      { q: "What is the derivative of x³?", say: "What is the derivative of x cubed?", options: ["3x²", "x²", "3x³"], answer: 0, skill: "Introduction to Derivatives" },
      { q: "π radians = how many degrees?", say: "Pi radians equals how many degrees?", options: ["90°", "180°", "360°"], answer: 1, skill: "Trigonometric Functions" },
      { q: "What is the limit of (x + 3) as x approaches 2?", options: ["2", "3", "5"], answer: 2, skill: "Limits" },
    ],
  },
  reading: {
    K: [
      { q: "Which word rhymes with CAT?", options: ["hat", "dog", "sun"], answer: 0, skill: "Rhyming & Syllables" },
      { q: "Which word starts with the same sound as BALL?", options: ["cat", "bed", "sun"], answer: 1, skill: "Letter Names & Sounds" },
      { q: "Read: “I see a dog.”  What do I see?", say: "Read: I see a dog. What do I see?", options: ["a cat", "a dog", "a ball"], answer: 1, skill: "Sight Words" },
      { q: "Which one is a letter?", options: ["B", "7", "?"], answer: 0, skill: "Letter Names & Sounds" },
    ],
    "1": [
      { q: "Read: “The cat sat on the mat.”  Where did the cat sit?", say: "Read: The cat sat on the mat. Where did the cat sit?", options: ["on the bed", "on the mat", "in the hat"], answer: 1, skill: "Short Vowels & Blends" },
      { q: "Which word has a long A sound, like in “cake”?", options: ["cap", "cat", "game"], answer: 2, skill: "Long Vowels & Silent E" },
      { q: "Which word is spelled correctly?", options: ["frogg", "frog", "forg"], answer: 1, skill: "Short Vowels & Blends" },
      { q: "Read: “Tom ran fast to catch the bus.”  Why did Tom run?", say: "Read: Tom ran fast to catch the bus. Why did Tom run?", options: ["to catch the bus", "to play a game", "to find his dog"], answer: 0, skill: "Main Idea & Details" },
    ],
    "2": [
      { q: "Which word means “not happy”?", options: ["unhappy", "rehappy", "happyful"], answer: 0, skill: "Prefixes & Suffixes" },
      { q: "Read: “Mia planted seeds. She watered them every day. Soon, green sprouts came up.”  What happened after Mia watered the seeds?", say: "Read: Mia planted seeds. She watered them every day. Soon, green sprouts came up. What happened after Mia watered the seeds?", options: ["The seeds blew away.", "Green sprouts came up.", "It started to snow."], answer: 1, skill: "Retelling & Lessons" },
      { q: "In “The tall girl ran home,” which word describes the girl?", options: ["tall", "ran", "home"], answer: 0, skill: "Adjectives & Adverbs" },
      { q: "What is the plural of “box”?", options: ["boxs", "boxes", "boxies"], answer: 1, skill: "Vowel Teams & R-Controlled Vowels" },
    ],
    "3": [
      { q: "Read: “Leo forgot his lunch, so his friend Ana shared her sandwich.”  What does this show about Ana?", say: "Read: Leo forgot his lunch, so his friend Ana shared her sandwich. What does this show about Ana?", options: ["She is kind.", "She is hungry.", "She is late."], answer: 0, skill: "Characters & Their Feelings" },
      { q: "“The puppy was so tiny it fit in my hand.”  What does “tiny” mean?", options: ["very loud", "very small", "very fast"], answer: 1, skill: "Context Clues" },
      { q: "Which sentence is correct?", options: ["She walk to school.", "She walks to school.", "She walking to school."], answer: 1, skill: "Verb Tenses & Agreement" },
      { q: "“Bees make honey. They also help flowers grow by carrying pollen. Bees are important to nature.”  What is the main idea?", options: ["Bees are important to nature.", "Honey is sweet.", "Flowers are pretty."], answer: 0, skill: "Main Idea in Nonfiction" },
    ],
    "4": [
      { q: "“The classroom was a zoo.”  What kind of figurative language is this?", options: ["simile", "metaphor", "rhyme"], answer: 1, skill: "Figurative Language" },
      { q: "The root “bio” (as in biology) means:", options: ["life", "earth", "write"], answer: 0, skill: "Greek & Latin Roots" },
      { q: "A text uses “First... Next... Then... Finally...”  What is its structure?", options: ["compare and contrast", "chronological order", "problem and solution"], answer: 1, skill: "Text Structure" },
      { q: "In a story, a slow turtle keeps going and beats a fast rabbit who stopped to nap. What is the theme?", options: ["Rabbits are fast.", "Steady effort pays off.", "Naps are good for you."], answer: 1, skill: "Theme & Summary" },
    ],
    "5": [
      { q: "A story says, “I opened the door and gasped.”  What point of view is this?", options: ["first person", "second person", "third person"], answer: 0, skill: "Point of View" },
      { q: "Which word means about the same as “enormous”?", options: ["tiny", "huge", "quiet"], answer: 1, skill: "Context Clues & Word Roots" },
      { q: "Which sentence is a fact, not an opinion?", options: ["Pizza is the best food.", "Water freezes at 32°F.", "Summer is the most fun season."], answer: 1, skill: "Opinion & Argument Writing" },
      { q: "Which sentence uses commas correctly?", options: ["I bought apples, oranges, and pears.", "I bought, apples oranges and pears.", "I, bought apples oranges, and pears."], answer: 0, skill: "Grammar & Conventions" },
    ],
    "6": [
      { q: "“Maria practiced piano every night for months. At the recital, her hands didn't shake once.”  Which detail best shows Maria was prepared?", options: ["She practiced every night for months.", "There was a recital.", "She plays the piano."], answer: 0, skill: "Citing Textual Evidence" },
      { q: "An objective summary should NOT include:", options: ["the main idea", "your own opinions", "key details"], answer: 1, skill: "Central Idea" },
      { q: "“The benevolent king gave food to every hungry family.”  “Benevolent” most likely means:", options: ["kind and generous", "angry", "very rich"], answer: 0, skill: "Vocabulary in Context" },
      { q: "Which is correct?", options: ["Between you and I", "Between you and me", "Between yourself and I"], answer: 1, skill: "Pronouns" },
    ],
    "7": [
      { q: "“Some people say homework is useless, but studies show it improves grades.”  The author's purpose is mostly to:", options: ["entertain", "persuade", "describe a place"], answer: 1, skill: "Author's Purpose & Point of View" },
      { q: "“Jake stared at the clock, tapped his foot, and sighed for the third time.”  Jake is probably feeling:", options: ["impatient", "excited", "scared"], answer: 0, skill: "Inferences & Evidence" },
      { q: "Which is a complex sentence?", options: ["We played outside.", "Although it rained, we played outside.", "It rained, and we played outside."], answer: 1, skill: "Sentence Variety" },
      { q: "Which source is most reliable for a report on volcanoes?", options: ["a university geology website", "an anonymous comment online", "a social media post"], answer: 0, skill: "Research Writing" },
    ],
    "8": [
      { q: "In an argument essay, a “counterclaim” is:", options: ["the writer's main claim", "an opposing argument", "a summary"], answer: 1, skill: "Argument with Counterclaims" },
      { q: "Which sentence is in the passive voice?", options: ["Sam threw the ball.", "The ball was thrown by Sam.", "Sam is throwing the ball."], answer: 1, skill: "Verbals & Voice" },
      { q: "Which word has the most negative connotation?", options: ["thrifty", "economical", "cheap"], answer: 2, skill: "Connotation & Word Choice" },
      { q: "Dramatic irony is when:", options: ["the audience knows something a character doesn't", "a character tells a joke", "the story is set in the past"], answer: 0, skill: "Analyzing Dialogue & Events" },
    ],
    "9": [
      { q: "An appeal to ethos relies on:", options: ["emotion", "logic and facts", "the speaker's credibility"], answer: 2, skill: "Rhetoric" },
      { q: "Which sentence uses parallel structure?", options: ["She likes hiking, swimming, and to bike.", "She likes hiking, swimming, and biking.", "She likes to hike, swimming, and biking."], answer: 1, skill: "Phrases & Clauses" },
      { q: "Which is a theme, not just a topic?", options: ["courage", "Courage means acting even when you are afraid.", "a story about a fire"], answer: 1, skill: "Literary Analysis" },
      { q: "“Peter Piper picked a peck of pickled peppers” is an example of:", options: ["alliteration", "onomatopoeia", "hyperbole"], answer: 0, skill: "Poetry" },
    ],
    "10": [
      { q: "“Everyone is buying these shoes, so they must be the best.”  This is which fallacy?", options: ["bandwagon", "straw man", "slippery slope"], answer: 0, skill: "Evaluating Reasoning" },
      { q: "Which sentence uses a semicolon correctly?", options: ["I studied hard; I passed the test.", "I studied; hard and passed.", "I; studied hard and passed the test."], answer: 0, skill: "Semicolons & Colons" },
      { q: "Plagiarism is:", options: ["quoting a source with credit", "using someone's words or ideas without giving credit", "summarizing a book"], answer: 1, skill: "Research Papers" },
      { q: "In a play, a soliloquy is when:", options: ["two characters argue", "a character speaks their thoughts aloud alone on stage", "the scene changes"], answer: 1, skill: "Shakespeare & Drama" },
    ],
    "11": [
      { q: "In writing, “synthesis” means:", options: ["copying one source", "combining ideas from several sources into one argument", "listing sources"], answer: 1, skill: "Synthesis" },
      { q: "A rhetorical question is asked:", options: ["to get a real answer", "for effect, without expecting an answer", "to change the subject"], answer: 1, skill: "Rhetorical Analysis" },
      { q: "“The once-proud factory sat silent, its windows shattered.”  The tone is:", options: ["cheerful", "somber", "humorous"], answer: 1, skill: "American Literature" },
      { q: "Which revision is the most concise?", options: ["Due to the fact that it was raining, we stayed inside.", "Because it was raining, we stayed inside.", "Owing to the rain that was falling, we remained inside."], answer: 1, skill: "Style & Usage" },
    ],
    "12": [
      { q: "Which is a primary source about World War II?", options: ["a letter written by a soldier in 1944", "a textbook chapter written in 2020", "an encyclopedia article"], answer: 0, skill: "Critical Lenses" },
      { q: "A news article shows bias when it:", options: ["presents several viewpoints fairly", "uses one-sided, loaded language", "cites its sources"], answer: 1, skill: "Media Literacy" },
      { q: "Which resume line is strongest?", options: ["I am a hard worker.", "Led a team of 5 that finished a project two weeks early.", "I did a lot of things at my job."], answer: 1, skill: "Workplace & Real-World Writing" },
      { q: "A strong argument on a complex issue should:", options: ["ignore opposing evidence", "weigh evidence and address other views", "rely only on emotion"], answer: 1, skill: "Advanced Argument" },
    ],
  },
};

export const PLACEMENT_GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

export function gradeIndex(grade) { return PLACEMENT_GRADES.indexOf(grade); }

// The grade to test first: one below their grade by age (many kids who've
// had interrupted schooling are a little behind; starting just below builds
// confidence, and the test moves up quickly if they're ready).
export function startingGrade(ageGrade) {
  return PLACEMENT_GRADES[Math.max(0, gradeIndex(ageGrade) - 1)];
}

// Given the results so far ([{ grade, score }] in the order taken), returns
// the next grade to test, or null when the placement is finished.
export function nextGrade(history) {
  if (history.length === 0) return null;
  const last = history[history.length - 1];
  const passed = last.score >= PASS_SCORE;
  const idx = gradeIndex(last.grade);
  const tested = new Set(history.map((h) => h.grade));
  const next = PLACEMENT_GRADES[idx + (passed ? 1 : -1)];
  if (!next || tested.has(next)) return null;
  return next;
}

// Working level = the grade just above the highest grade passed
// (K if none passed; 12th if they passed 12th).
export function workingLevel(history) {
  const passedIdx = history.filter((h) => h.score >= PASS_SCORE).map((h) => gradeIndex(h.grade));
  if (passedIdx.length === 0) return "K";
  return PLACEMENT_GRADES[Math.min(PLACEMENT_GRADES.length - 1, Math.max(...passedIdx) + 1)];
}

/* PhonoLens sound drills: short sentences packed with one sound (and the sound it is often
   confused with), plus a recommender that looks at the learner's recent mistakes.
   Exposes window.PLDrills. */
(() => {
"use strict";

const SETS = [
  { id: "v", target: "v", vs: "w", title: "/v/ vs /w/", hint: "very · west", items: [
    "Very well, we will visit Vivek.", "The van went west in the wind.", "Vote for the wise village vet.",
    "We value every vivid view.", "Victor wore a warm velvet vest."] },
  { id: "w", target: "w", vs: "v", title: "/w/ as in west", hint: "west · wine", items: [
    "We went for a walk in the woods.", "Why would William wait?", "Wendy wore white wool.",
    "The wind was wild on Wednesday.", "Wash the window with warm water."] },
  { id: "th", target: "θ", vs: "t", title: "/θ/ as in thin", hint: "thin · three", items: [
    "Thank you for the thoughtful gift.", "Three thin thieves thought hard.", "Both of them think it's worth it.",
    "Thirty-three thirsty birds.", "Ruth threw the cloth north."] },
  { id: "dh", target: "ð", vs: "d", title: "/ð/ as in this", hint: "this · mother", items: [
    "This is the other brother.", "They gathered there together.", "These are those feathers.",
    "Mother and father bathe them.", "Breathe with them, then rest."] },
  { id: "z", target: "z", vs: "s", title: "/z/ as in zoo", hint: "zoo · bags", items: [
    "Zebras zigzag at the zoo.", "His dogs eat bags of peas.", "Close the doors, please.",
    "The busy bees buzz all day.", "Roses grow in rows."] },
  { id: "sh", target: "ʃ", vs: "s", title: "/ʃ/ as in she", hint: "she · wash", items: [
    "She shows short shirts.", "Wash the dishes in the sink.", "Sue shut the shop.",
    "The ship sails near the shore.", "Shelly sells fresh fish."] },
  { id: "zh", target: "ʒ", vs: "dʒ", title: "/ʒ/ as in measure", hint: "measure · vision", items: [
    "Measure the pleasure of the treasure.", "It was an unusual decision.", "Leisure is a casual pleasure.",
    "Her vision was a vivid illusion.", "Usually the beige one wins."] },
  { id: "f", target: "f", vs: "p", title: "/f/ as in fan", hint: "fan · coffee", items: [
    "Five fine fish swim fast.", "Fifty friendly farmers laughed.", "Fresh coffee for Fred.",
    "Find a phone for Philip.", "The fan is off at four."] },
  { id: "l", target: "l", vs: "-", title: "/l/ in clusters", hint: "sells · old", items: [
    "Sell all the shells.", "Bill tells tall tales.", "The milk will spill.",
    "Twelve old bells.", "Feel the cold wind."] },
  { id: "ae", target: "æ", vs: "ɛ", title: "/æ/ vs /ɛ/", hint: "bad · bed", items: [
    "The cat sat on a bad mat.", "Pack the black bag.", "Sam has a happy cat.",
    "That man ran fast.", "Jack had an apple and a pen."] },
  { id: "i", target: "i", vs: "ɪ", title: "/i/ vs /ɪ/", hint: "sheep · ship", items: [
    "Please sit in this seat.", "The big sheep is on the ship.", "Feel the hill with your feet.",
    "Bill will eat the meal.", "Keep the kids in the green field."] },
  { id: "u", target: "u", vs: "ʊ", title: "/u/ vs /ʊ/", hint: "food · book", items: [
    "Look at the food in the book.", "Pull the pool cover.", "Good boots for June.",
    "Could you choose a cook?", "The full moon came soon."] },
  { id: "er", target: "ɝ", vs: "ʌ", title: "/ɝ/ as in bird", hint: "bird · work", items: [
    "Birds learn early.", "The nurse heard a word.", "Her first turn was hard work.",
    "Thirty purple shirts.", "Early birds earn more."] },
];

const BY_TARGET = {};
SETS.forEach((s) => { BY_TARGET[s.target] = s; });

function forPhone(ph) { return BY_TARGET[ph] || null; }

/* Count recent problem sounds (needs work = 2 points, almost = 1) over the last sessions and
   the current result, and return drill sets ordered by how often they came up. */
function recommend(history, current, limit = 3) {
  const score = {};
  const add = (ph, w) => { if (BY_TARGET[ph]) score[ph] = (score[ph] || 0) + w; };
  (history || []).slice(-10).forEach((h) => (h.issues || []).forEach(([ph, , k]) => add(ph, k === "bad" ? 2 : 1)));
  (current || []).forEach(([ph, , k]) => add(ph, k === "bad" ? 2 : 1));
  return Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([ph, n]) => ({ set: BY_TARGET[ph], weight: n }));
}

window.PLDrills = { SETS, forPhone, recommend };
})();

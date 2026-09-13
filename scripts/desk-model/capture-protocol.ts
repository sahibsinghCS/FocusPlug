import {
  FIRST_PERSON_MIN_EVAL_GROUPS,
  FIRST_PERSON_PROTOCOL,
  FIRST_PERSON_PROTOCOL_CLIPS,
} from "./first-person";

/**
 * `npm run capture:protocol` — the recording protocol, printed from the same
 * constant the docs quote, so the two cannot drift (first-person.test.ts
 * asserts docs/CUSTOM-MODEL.md still contains every line of it).
 */
const RULE = "─".repeat(74);

console.log(RULE);
console.log(
  `FIRST-PERSON CAPTURE PROTOCOL — ${FIRST_PERSON_PROTOCOL_CLIPS} clips, about two minutes, no labelling step`,
);
console.log(RULE);
for (const line of FIRST_PERSON_PROTOCOL) {
  console.log(line.startsWith("npm ") || line.startsWith("npx ") ? `    ${line}` : `\n${line}`);
}
console.log("");
console.log(RULE);
console.log(
  `The eval refuses to print a first-person accuracy below ${FIRST_PERSON_MIN_EVAL_GROUPS} independent eval clips,` +
    " and states the clip count next to every first-person number it does print.",
);
console.log(RULE);

// Writes tokens.css from src/index.ts. Run with `npm run tokens` (Node strips TS types).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toCssVariables } from "../src/css.ts";

const out = fileURLToPath(new URL("../tokens.css", import.meta.url));
writeFileSync(out, toCssVariables());
process.stdout.write(`Wrote ${out}\n`);

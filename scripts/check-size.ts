import { statSync } from "node:fs";

const file = "dist/extension.cjs";
const limit = 65_536; // SPEC §8
const size = statSync(file).size;
const verdict = size <= limit ? "ok" : "too large";
console.log(`${file}: ${size} bytes (limit ${limit}) ${verdict}`);
if (size > limit) process.exit(1);

// Writes tokens.css and tokens.json next to package.json.
import { writeFileSync } from "node:fs";
import { renderCss, renderJson } from "./css.ts";

const root = new URL("../", import.meta.url);
writeFileSync(new URL("tokens.css", root), renderCss());
writeFileSync(new URL("tokens.json", root), renderJson());
console.log("wrote tokens.css and tokens.json");

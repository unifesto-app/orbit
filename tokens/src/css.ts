// Renders the tokens as CSS custom properties (tokens.css) and as JSON (tokens.json) for tools and the brand kit.
import { channels, depth, font, functional, glass, palette, radius, role, space } from "./index.ts";

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-z])(\d)/g, "$1-$2").toLowerCase();

export function renderCss(): string {
  const lines: string[] = [];
  const add = (name: string, value: string | number) => lines.push(`  --orbit-${name}: ${value};`);
  lines.push("  /* Palette */");
  for (const [k, v] of Object.entries(palette)) add(k, v);
  for (const [k, v] of Object.entries(functional)) add(k, v);
  // Channels, for any opacity: rgb(var(--orbit-stone-rgb) / 0.5).
  add("stone-rgb", channels(palette.stone).join(" "));
  add("charcoal-rgb", channels(palette.charcoal).join(" "));
  add("accent-rgb", channels(role.accent).join(" "));
  lines.push("  /* Roles */");
  for (const [k, v] of Object.entries(role)) add(kebab(k), v);
  lines.push("  /* Shape and space */");
  add("radius", `${radius.corner}px`);
  add("radius-pill", `${radius.pill}px`);
  add("space-small", `${space.small}px`);
  add("space-big", `${space.big}px`);
  add("rim", `${space.rim}px`);
  lines.push("  /* Type */");
  add("tracking-display", font.tracking.display);
  for (const [k, v] of Object.entries(font.weight)) add(`weight-${k}`, v);
  lines.push("  /* Glass: every button and floating control */");
  for (const [k, v] of Object.entries(glass)) add(`glass-${k}`, v);
  return (
    "/* Generated from tokens/src/index.ts by `pnpm --filter @orbit/tokens build`. Don't edit by hand. */\n" +
    `:root {\n${lines.join("\n")}\n}\n`
  );
}

export function renderJson(): string {
  return JSON.stringify({ palette, functional, role, radius, space, font, glass, depth }, null, 2) + "\n";
}

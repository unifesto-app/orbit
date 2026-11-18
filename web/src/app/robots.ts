import type { MetadataRoute } from "next";
import { SITE } from "./site";

// Every page open to every crawler (owner, 18 Nov 2026: "google indexing should happen", "llms, chatgpt, claude, gemini
// optimizations"). The AI crawlers are named too, so a reader sees they are welcome on purpose. Cloudflare's "Block AI
// bots" and "Managed robots.txt" settings override this file; both must stay off for heyorbit.in.
const AI = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  "Google-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot-Extended",
  "meta-externalagent",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: AI, allow: "/" },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}

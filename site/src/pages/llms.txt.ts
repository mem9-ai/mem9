import type { APIRoute } from "astro";
import { discoverabilityCopy, seoKeywords } from "../content/discoverability";
import { DEFAULT_LOCALE, siteCopy } from "../content/site";

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site ?? new URL("https://mem9.ai");
  const copy = siteCopy[DEFAULT_LOCALE];
  const discoverability = discoverabilityCopy[DEFAULT_LOCALE];
  const body = [
    "# mem9",
    "",
    `> ${copy.meta.description}`,
    "",
    "mem9 is persistent memory infrastructure for coding agents and AI assistants.",
    "It gives OpenClaw, Claude Code, OpenCode, and custom runtimes durable long-term memory with hybrid retrieval and shared recall.",
    "",
    "## Primary URLs",
    `- Home: ${new URL("/", siteUrl).toString()}`,
    `- Stable onboarding: ${new URL("/SKILL.md", siteUrl).toString()}`,
    `- Beta onboarding: ${new URL("/beta/SKILL.md", siteUrl).toString()}`,
    "- GitHub: https://github.com/mem9-ai/mem9",
    "",
    "## Common search intents",
    ...seoKeywords.map((keyword) => `- ${keyword}`),
    "",
    "## Key questions",
    ...discoverability.faq.items.map((item) => `- ${item.question}`),
    "",
    `For a longer machine-readable summary, see ${new URL("/llms-full.txt", siteUrl).toString()}.`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};

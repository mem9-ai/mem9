import type { APIRoute } from "astro";
import { faqCopy } from "../content/discoverability";
import { DEFAULT_LOCALE, siteCopy } from "../content/site";

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site ?? new URL("https://mem9.ai");
  const copy = siteCopy[DEFAULT_LOCALE];
  const faq = faqCopy[DEFAULT_LOCALE];
  const body = [
    "# mem9",
    "",
    `> ${copy.meta.description}`,
    "",
    "## What it is",
    copy.hero.subtitle,
    "",
    "## Core features",
    ...copy.features.items.map((item) => `- ${item.title}: ${item.description}`),
    "",
    "## Agent support",
    ...copy.platforms.items.map((item) => `- ${item.name}: ${item.detail}`),
    "",
    "## FAQ",
    ...faq.items.flatMap((item) => [`- Q: ${item.question}`, `  A: ${item.answer}`]),
    "",
    "## Canonical resources",
    `- Home: ${new URL("/", siteUrl).toString()}`,
    `- Stable onboarding: ${new URL("/SKILL.md", siteUrl).toString()}`,
    `- Beta onboarding: ${new URL("/beta/SKILL.md", siteUrl).toString()}`,
    "- GitHub repository: https://github.com/mem9-ai/mem9",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};

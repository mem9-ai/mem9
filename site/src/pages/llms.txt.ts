import type { APIRoute } from 'astro';

export const prerender = true;

const fallbackSiteUrl = 'https://mem9.ai';

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site ?? new URL(fallbackSiteUrl);
  const link = (label: string, path: string, description: string): string => (
    `- [${label}](${new URL(path, siteUrl).toString()}): ${description}`
  );
  const llmsText = [
    '# mem9',
    '',
    '> Shared, cloud-persistent memory infrastructure for AI agents and agentic applications.',
    '',
    'mem9 provides durable memory across sessions, machines, agents, and applications, with hybrid recall and a visual management console.',
    '',
    '## Documentation',
    '',
    link('Product overview', '/', 'Capabilities, supported agents, benchmarks, security, and common questions.'),
    link('User guide', '/docs/', 'Setup, integrations, security, pricing, and operating guidance.'),
    link('API reference', '/api/', 'REST API authentication, endpoints, schemas, and examples.'),
    link('Console guide', '/console-docs/', 'Web console workflows for spaces, memory review, usage, billing, and settings.'),
    link('OpenClaw memory guide', '/openclaw-memory/', 'Persistent memory setup and usage for OpenClaw.'),
    '',
    '## Agent resources',
    '',
    link('Agent skill', '/SKILL.md', 'Stable agent-readable installation and operating instructions.'),
    link('Setup guide', '/SETUP.md', 'Detailed setup and reconnection steps.'),
    link('Troubleshooting guide', '/TROUBLESHOOTING.md', 'Known setup and runtime recovery procedures.'),
    link('Uninstall guide', '/UNINSTALL.md', 'Cleanup and removal instructions.'),
    '',
    '## Optional',
    '',
    link('Pricing', '/pricing/', 'Plans, included usage, and billing controls.'),
    link('Release notes', '/release-notes/', 'Product changes and version history.'),
    '- [Source code](https://github.com/mem9-ai/mem9): Core server, site, dashboard, CLI, and in-repo agent integrations.',
    '',
  ].join('\n');

  return new Response(llmsText, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};

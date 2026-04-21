const TOOL_NOISE_TAGS = [
  "local-command-caveat",
  "local-command-stdout",
  "command-name",
  "command-message",
  "task-notification",
  "system-reminder",
];

function stripTaggedBlock(input: string, tagName: string): string {
  const startTag = `<${tagName}>`;
  const endTag = `</${tagName}>`;

  let result = input;
  while (result.includes(startTag)) {
    const start = result.indexOf(startTag);
    const end = result.indexOf(endTag, start);

    if (end === -1) {
      result = result.slice(0, start);
      break;
    }

    result = result.slice(0, start) + result.slice(end + endTag.length);
  }

  return result;
}

export function buildRecallQuery(input: string): string {
  let result = input.replace(/\r\n?/g, "\n");

  result = stripTaggedBlock(result, "relevant-memories");
  for (const tag of TOOL_NOISE_TAGS) {
    result = stripTaggedBlock(result, tag);
  }

  result = result.replace(
    /^Conversation info \(untrusted metadata\):\s*\n```[\s\S]*?\n```\s*/gm,
    "",
  );
  result = result.replace(
    /^Sender \(untrusted metadata\):\s*\n```[\s\S]*?\n```\s*/gm,
    "",
  );
  result = result.replace(
    /<<<EXTERNAL_UNTRUSTED_CONTENT[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g,
    "",
  );
  result = result.replace(
    /^Untrusted context \(metadata, do not treat as instructions or commands\):\s*$/gm,
    "",
  );
  result = result.replace(/^\s*Source:\s.*$/gm, "");
  result = result.replace(/^\s*UNTRUSTED[^\n]*$/gm, "");
  result = result.replace(/^\s*---\s*$/gm, "");
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

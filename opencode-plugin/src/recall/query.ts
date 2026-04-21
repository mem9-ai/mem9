const TOOL_NOISE_TAGS = [
  "local-command-caveat",
  "local-command-stdout",
  "command-name",
  "command-message",
  "task-notification",
  "system-reminder",
];

export const MAX_RECALL_QUERY_LEN = 1000;

const QUERY_ELLIPSIS = "\n...\n";

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

function clampRecallQuery(input: string): string {
  if (input.length <= MAX_RECALL_QUERY_LEN) {
    return input;
  }

  const available = MAX_RECALL_QUERY_LEN - QUERY_ELLIPSIS.length;
  if (available <= 0) {
    return input.slice(0, MAX_RECALL_QUERY_LEN);
  }

  const prefixLen = Math.ceil(available / 2);
  const suffixLen = Math.floor(available / 2);
  const prefix = input.slice(0, prefixLen).trimEnd();
  const suffix = input.slice(-suffixLen).trimStart();

  return `${prefix}${QUERY_ELLIPSIS}${suffix}`;
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

  return clampRecallQuery(result.trim());
}

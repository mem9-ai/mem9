const TOOL_NOISE_TAGS = [
  "local-command-caveat",
  "local-command-stdout",
  "command-name",
  "command-message",
  "task-notification",
  "system-reminder",
];

export const MAX_RECALL_QUERY_LEN = 1000;
export const MAX_RECALL_QUERY_PARAM_LEN = 1600;

const QUERY_ELLIPSIS = "\n...\n";
const QUERY_PARAM_KEY = "q";

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
  if (input.length <= MAX_RECALL_QUERY_LEN && encodedQueryParamLength(input) <= MAX_RECALL_QUERY_PARAM_LEN) {
    return input;
  }

  const chars = Array.from(input);
  let best = truncatePrefixToEncodedBudget(chars);
  let low = 2;
  let high = Math.max(chars.length - 2, 0);

  while (low <= high) {
    const keptChars = Math.floor((low + high) / 2);
    const candidate = buildBalancedCandidate(chars, keptChars);

    if (encodedQueryParamLength(candidate) <= MAX_RECALL_QUERY_PARAM_LEN) {
      best = candidate;
      low = keptChars + 1;
    } else {
      high = keptChars - 1;
    }
  }

  return best;
}

function encodedQueryParamLength(input: string): number {
  return new URLSearchParams({ [QUERY_PARAM_KEY]: input }).toString().length;
}

function buildBalancedCandidate(chars: string[], keptChars: number): string {
  if (keptChars <= 0) {
    return QUERY_ELLIPSIS;
  }

  const prefixLen = Math.ceil(keptChars / 2);
  const suffixLen = Math.floor(keptChars / 2);
  const prefix = chars.slice(0, prefixLen).join("").trimEnd();
  const suffix = chars.slice(chars.length - suffixLen).join("").trimStart();

  return `${prefix}${QUERY_ELLIPSIS}${suffix}`;
}

function truncatePrefixToEncodedBudget(chars: string[]): string {
  let low = 0;
  let high = chars.length;
  let best = "";

  while (low <= high) {
    const length = Math.floor((low + high) / 2);
    const candidate = chars.slice(0, length).join("").trimEnd();

    if (encodedQueryParamLength(candidate) <= MAX_RECALL_QUERY_PARAM_LEN) {
      best = candidate;
      low = length + 1;
    } else {
      high = length - 1;
    }
  }

  return best;
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

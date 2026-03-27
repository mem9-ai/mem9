export interface PixelFarmDialogPaginationInput {
  text: string;
  maxLines: number;
  measureLineCount: (value: string) => number;
}

function normalizeDialogText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function splitIntoSentenceUnits(text: string): string[] {
  const sentenceUnits = text.split(/(?<=[.!?。！？])\s+/).map((unit) => unit.trim()).filter(Boolean);
  return sentenceUnits.length > 0 ? sentenceUnits : [text];
}

function pushWordGroup(
  pages: string[],
  words: string[],
  maxLines: number,
  measureLineCount: (value: string) => number,
): void {
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && measureLineCount(next) > maxLines) {
      pages.push(current);
      current = word;
      continue;
    }

    current = next;
  }

  if (current) {
    pages.push(current);
  }
}

export function paginatePixelFarmDialogText(
  input: PixelFarmDialogPaginationInput,
): string[] {
  const normalized = normalizeDialogText(input.text);
  if (!normalized) {
    return [""];
  }

  if (input.measureLineCount(normalized) <= input.maxLines) {
    return [normalized];
  }

  const pages: string[] = [];
  const sentenceUnits = splitIntoSentenceUnits(normalized);
  let current = "";

  for (const unit of sentenceUnits) {
    const next = current ? `${current} ${unit}` : unit;
    if (current && input.measureLineCount(next) > input.maxLines) {
      pages.push(current);
      current = unit;
      continue;
    }

    if (input.measureLineCount(unit) > input.maxLines) {
      if (current) {
        pages.push(current);
        current = "";
      }

      pushWordGroup(pages, unit.split(" ").filter(Boolean), input.maxLines, input.measureLineCount);
      continue;
    }

    current = next;
  }

  if (current) {
    pages.push(current);
  }

  return pages;
}

export async function copyText(text: string): Promise<boolean> {
  let clipboardCopy = false;
  try {
    if (navigator.clipboard?.writeText) {
      clipboardCopy = await Promise.race([
        navigator.clipboard.writeText(text).then(() => true, () => false),
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 1000)),
      ]);
    }
  } catch {
    clipboardCopy = false;
  }

  if (clipboardCopy) {
    return true;
  }

  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : [];
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  activeElement?.focus({ preventScroll: true });

  if (selection && ranges.length > 0) {
    selection.removeAllRanges();
    ranges.forEach((range) => selection.addRange(range));
  }

  return copied;
}

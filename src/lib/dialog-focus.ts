export function nextDialogFocusIndex(length: number, currentIndex: number, backwards: boolean) {
  if (length <= 0) return -1;
  if (currentIndex < 0) return backwards ? length - 1 : 0;
  return backwards
    ? (currentIndex - 1 + length) % length
    : (currentIndex + 1) % length;
}

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute("disabled") && element.getClientRects().length > 0);
}

export function trapDialogFocus(event: KeyboardEvent, dialog: HTMLElement | null) {
  if (event.key !== "Tab" || !dialog) return false;

  const elements = focusableElements(dialog);
  if (elements.length === 0) {
    event.preventDefault();
    dialog.focus();
    return true;
  }

  const activeIndex = elements.indexOf(document.activeElement as HTMLElement);
  const nextIndex = nextDialogFocusIndex(elements.length, activeIndex, event.shiftKey);
  const shouldWrap = activeIndex < 0
    || (!event.shiftKey && activeIndex === elements.length - 1)
    || (event.shiftKey && activeIndex === 0);
  if (!shouldWrap) return false;

  event.preventDefault();
  elements[nextIndex]?.focus();
  return true;
}

export function restoreDialogFocus(target: HTMLElement | null, fallback: HTMLElement | null = null) {
  const focusTarget = target?.isConnected ? target : fallback?.isConnected ? fallback : null;
  focusTarget?.focus();
}

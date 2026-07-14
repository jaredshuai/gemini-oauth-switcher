import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "[data-dialog-autofocus]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function useModalBehavior(options: {
  onClose: () => void;
  closeDisabled?: boolean;
}): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(options.onClose);
  const closeDisabledRef = useRef(Boolean(options.closeDisabled));
  onCloseRef.current = options.onClose;
  closeDisabledRef.current = Boolean(options.closeDisabled);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const siblings = dialog.parentElement
      ? Array.from(dialog.parentElement.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialog)
      : [];
    const previousInertValues = siblings.map((element) => ({ element, inert: element.inert }));
    for (const { element } of previousInertValues) {
      element.inert = true;
    }

    const getFocusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0);
    const focusFrame = requestAnimationFrame(() => {
      const preferred = dialog.querySelector<HTMLElement>("[data-dialog-autofocus]");
      (preferred ?? getFocusableElements()[0] ?? dialog).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!closeDisabledRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      for (const { element, inert } of previousInertValues) {
        element.inert = inert;
      }
      previousFocus?.focus();
    };
  }, []);

  return dialogRef;
}

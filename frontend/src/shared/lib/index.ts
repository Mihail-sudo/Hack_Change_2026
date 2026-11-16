import { useEffect, useRef } from "react";

interface DrawerFocusOptions {
  onClose: () => void;
  enabled: boolean;
}

export function useDrawerFocus<T extends HTMLElement>({
  onClose,
  enabled,
}: DrawerFocusOptions) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [enabled, onClose]);

  return ref;
}

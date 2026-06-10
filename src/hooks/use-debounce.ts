"use client";

import { useState, useEffect } from "react";

/**
 * Returns a debounced version of `value` that only updates after `delay` ms of
 * inactivity. Use in search inputs to avoid firing a query on every keystroke.
 */
export function useDebounce<T>(value: T, delay = 400): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

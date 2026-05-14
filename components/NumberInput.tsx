"use client";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";

interface Props
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number;
  onValueChange: (v: number) => void;
  /** Number to emit when the field is blank. Default 0. */
  emptyValue?: number;
}

// Controlled <input type="number"> that always shows exactly what the user
// typed. React skips DOM updates when the controlled prop doesn't change, so
// typing a leading "0" before "275" produces DOM "0275" that parses back to
// 275 — same number, so React never repaints and the user is stuck looking
// at "0275". We hold an internal string mirror, re-sync only when the parent
// number changes from somewhere else, and canonicalize on blur.
export const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput(
  { value, onValueChange, emptyValue = 0, onBlur, ...rest },
  ref,
) {
  const [text, setText] = useState<string>(() => toText(value));
  const lastEmittedRef = useRef<number>(value);

  useEffect(() => {
    if (!Object.is(value, lastEmittedRef.current)) {
      setText(toText(value));
      lastEmittedRef.current = value;
    }
  }, [value]);

  return (
    <input
      ref={ref}
      type="number"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const parsed = next === "" ? emptyValue : Number(next);
        if (Number.isFinite(parsed)) {
          lastEmittedRef.current = parsed;
          onValueChange(parsed);
        }
      }}
      onBlur={(e) => {
        const canonical = toText(value);
        if (text !== canonical) setText(canonical);
        onBlur?.(e);
      }}
      {...rest}
    />
  );
});

function toText(n: number): string {
  return Number.isFinite(n) ? String(n) : "";
}

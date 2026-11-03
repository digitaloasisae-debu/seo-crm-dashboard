"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { Spinner } from "./spinner";

/** A submit button that shows a spinner (only on the button that was clicked) while its form's server action runs. */
export function SubmitButton({ children, disabled, onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  const [clicked, setClicked] = useState(false);
  useEffect(() => { if (!pending) setClicked(false); }, [pending]);
  const busy = pending && clicked;
  return (
    <button
      {...rest}
      onClick={(e: MouseEvent<HTMLButtonElement>) => { setClicked(true); onClick?.(e); }}
      disabled={disabled || pending}
      aria-busy={busy}
    >
      {busy && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

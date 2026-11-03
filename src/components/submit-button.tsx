"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./spinner";

/** A submit button that shows a spinner and disables itself while its form's server action runs. */
export function SubmitButton({ children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button {...rest} disabled={disabled || pending} aria-busy={pending}>
      {pending && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

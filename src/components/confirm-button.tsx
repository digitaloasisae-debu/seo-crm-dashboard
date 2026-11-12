"use client";

import type { ButtonHTMLAttributes } from "react";
import { SubmitButton } from "./submit-button";

/** A SubmitButton that asks "Are you sure?" first. */
export function ConfirmButton({ message, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { message: string }) {
  return <SubmitButton {...rest} onClick={(e) => { if (!confirm(message)) e.preventDefault(); }} />;
}

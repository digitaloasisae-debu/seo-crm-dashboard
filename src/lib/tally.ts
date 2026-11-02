import { createHmac, timingSafeEqual } from "node:crypto";

// Tally webhook body: { eventId, eventType: "FORM_RESPONSE", createdAt, data: { submissionId, responseId, formId, formName, createdAt, fields: TallyField[] } }
export type TallyField = {
  key: string;
  label: string | null;
  type: string;
  value: unknown;
  options?: { id: string; text: string }[];
};

export type TallyPayload = {
  eventId: string;
  eventType: string;
  createdAt: string;
  data: {
    submissionId?: string;
    responseId?: string;
    formId: string;
    formName?: string;
    createdAt: string;
    fields: TallyField[];
  };
};

/** Tally signs each webhook: base64(HMAC-SHA256(body, signing secret)) in the `tally-signature` header. */
export function verifyTallySignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

function fieldText(f: TallyField): string {
  const v = f.value;
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x && typeof x === "object") return (x as { url?: string; name?: string }).url || (x as { name?: string }).name || "";
        const opt = f.options?.find((o) => o.id === x);
        return opt ? opt.text : String(x);
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const opt = f.options?.find((o) => o.id === v);
  return opt ? opt.text : String(v).trim();
}

/**
 * Field lookup by label prefix, case-insensitive; first non-empty match wins.
 * Same rule as WF0 "Map Form Fields", so small label edits in Tally don't break intake.
 */
export function fieldReader(payload: TallyPayload) {
  const fields = payload.data.fields.map((f) => ({ label: (f.label ?? "").trim().toLowerCase(), key: f.key, text: fieldText(f), type: f.type }));
  const get = (...prefixes: string[]): string => {
    for (const p of prefixes) {
      const lp = p.toLowerCase();
      for (const f of fields) {
        if ((f.label.startsWith(lp) || f.key === p) && f.text !== "") return f.text;
      }
    }
    return "";
  };
  /** Exact label match, for hidden fields like `client_slug`. */
  get.exact = (label: string): string => fields.find((f) => f.label === label.toLowerCase() && f.text !== "")?.text ?? "";
  return get;
}

export function submissionId(payload: TallyPayload): string {
  return payload.data.submissionId || payload.data.responseId || payload.eventId;
}

/** Remove secrets from a payload before it is kept in form_submissions. */
export function redactPayload(payload: TallyPayload, labelPrefixes: string[]): TallyPayload {
  const lp = labelPrefixes.map((p) => p.toLowerCase());
  return {
    ...payload,
    data: {
      ...payload.data,
      fields: payload.data.fields.map((f) =>
        lp.some((p) => (f.label ?? "").trim().toLowerCase().startsWith(p)) ? { ...f, value: "[encrypted in dashboard]" } : f,
      ),
    },
  };
}

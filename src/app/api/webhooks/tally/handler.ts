import { NextResponse, type NextRequest } from "next/server";
import type { FormKind } from "@prisma/client";
import { receiveSubmission } from "@/lib/intake";
import { verifyTallySignature, type TallyPayload } from "@/lib/tally";

export function tallyWebhook(form: FormKind, secretEnv: string) {
  return async function POST(req: NextRequest) {
    const raw = await req.text();
    if (!verifyTallySignature(raw, req.headers.get("tally-signature"), process.env[secretEnv])) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    let payload: TallyPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (payload.eventType !== "FORM_RESPONSE") return NextResponse.json({ ignored: payload.eventType });

    const { submission, duplicate } = await receiveSubmission(form, payload);
    // Always 200 once stored, so Tally doesn't retry; failures show on the Intake screen.
    return NextResponse.json({ id: submission.id, duplicate, processed: !!submission.processedAt, error: submission.error });
  };
}

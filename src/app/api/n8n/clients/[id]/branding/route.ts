import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkN8nAuth } from "@/lib/n8n";

// PATCH /api/n8n/clients/{id}/branding  (replaces "Append or update row in sheet" in WF2)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const body = z
    .object({
      brand_primary_color: z.string().optional(),
      brand_secondary_color: z.string().optional(),
      brand_accent_color: z.string().optional(),
      logo_url: z.string().optional(),
    })
    .safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const b = body.data;
  const client = await db.client.update({
    where: { id },
    data: {
      brandPrimaryColor: b.brand_primary_color,
      brandSecondaryColor: b.brand_secondary_color,
      brandAccentColor: b.brand_accent_color,
      logoUrl: b.logo_url,
    },
  });
  return NextResponse.json({ ok: true, id: client.id });
}

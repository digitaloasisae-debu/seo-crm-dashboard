import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { checkN8nAuth } from "@/lib/n8n";
import { clientForN8n } from "../../serialize";

// GET /api/n8n/clients/{id, slug or exact client name}  (replaces "Read Client Profile" in WF2)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const client = await db.client.findFirst({
    where: { OR: [{ id }, { slug: id }, { name: { equals: decodeURIComponent(id), mode: "insensitive" } }] },
    include: { brain: true, brandProfile: true },
  });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json(clientForN8n(client));
}

import { Prisma } from "@prisma/client";
import { db } from "./db";

type LogInput = {
  actorId?: string | null;
  actorTag?: string;
  clientId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

const json = (v: unknown) => (v === undefined ? undefined : (v as Prisma.InputJsonValue));

export async function logActivity(input: LogInput, tx: Prisma.TransactionClient = db) {
  await tx.activityLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorTag: input.actorTag,
      clientId: input.clientId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: json(input.before),
      after: json(input.after),
    },
  });
}

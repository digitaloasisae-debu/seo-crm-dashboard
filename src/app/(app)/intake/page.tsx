import { DataTable } from "@/components/data-table";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { retrySubmissionAction } from "../../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function IntakePage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const user = await requireUser();
  if (user.role === "MEMBER") return <Empty>Only admins can see the intake log.</Empty>;
  const { all } = await searchParams;
  const [subs, clients] = await Promise.all([
    db.formSubmission.findMany({ where: all ? {} : { processedAt: null }, orderBy: { receivedAt: "desc" }, take: 100 }),
    db.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        title="Intake"
        subtitle="Every Tally submission is logged here. Failed ones wait for a fix and a retry."
        actions={<a className="btn-secondary" href={all ? "/intake" : "/intake?all=1"}>{all ? "Show failed only" : "Show all"}</a>}
      />
      {subs.length === 0 ? <Empty>No failed submissions.</Empty> : (
        <div className="card overflow-x-auto p-0">
          <DataTable
            id="intake"
            bare
            columns={[{ key: "received", label: "Received", type: "date" }, { key: "form", label: "Form", type: "enum" }, { key: "result", label: "Result", type: "enum" }, { key: "client", label: "Client", type: "enum" }, { key: "fix", label: "", sortable: false, filterable: false }]}
            rows={subs.map((s) => ({
              id: s.id,
              values: { received: s.receivedAt.toISOString(), form: s.form.toLowerCase(), result: s.processedAt ? "processed" : "failed", client: s.clientId ? clientName.get(s.clientId) ?? "" : "", fix: "" },
              cells: {
                received: <span className="whitespace-nowrap">{fmtDate(s.receivedAt)}</span>,
                result: s.processedAt ? <Badge color="green">processed</Badge> : <span className="text-sm text-red-700">{s.error ?? "not processed"}</span>,
                fix: !s.processedAt ? (
                  <form action={retrySubmissionAction.bind(null, s.id)} className="flex gap-2">
                    {s.form === "KEYWORDS" && (
                      <select className="input" name="clientId" defaultValue="">
                        <option value="">Match by name</option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    <SubmitButton className="btn-secondary">Retry</SubmitButton>
                  </form>
                ) : null,
              },
            }))}
            presets={[{ label: "Failed", filters: { result: ["failed"] } }]}
            searchPlaceholder="Search submissions"
          />
        </div>
      )}
    </>
  );
}

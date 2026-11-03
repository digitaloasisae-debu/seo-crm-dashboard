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
          <table className="table">
            <thead><tr><th>Received</th><th>Form</th><th>Result</th><th>Client</th><th></th></tr></thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDate(s.receivedAt)}</td>
                  <td>{s.form.toLowerCase()}</td>
                  <td>{s.processedAt ? <Badge color="green">processed</Badge> : <span className="text-sm text-red-700">{s.error ?? "not processed"}</span>}</td>
                  <td>{s.clientId ? clientName.get(s.clientId) : ""}</td>
                  <td>
                    {!s.processedAt && (
                      <form action={retrySubmissionAction.bind(null, s.id)} className="flex gap-2">
                        {s.form === "KEYWORDS" && (
                          <select className="input" name="clientId" defaultValue="">
                            <option value="">Match by name</option>
                            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        )}
                        <SubmitButton className="btn-secondary">Retry</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

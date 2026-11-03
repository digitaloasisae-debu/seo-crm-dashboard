import Link from "next/link";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export default async function Home() {
  const user = await requireUser();
  const scope = { client: clientScope(user, "edit") };

  const [pendingKeywords, topicsToReview, articlesToReview, failedPushes, openRequests, failedIntake, articles] = await Promise.all([
    db.keyword.count({ where: { ...scope, status: "PENDING" } }),
    db.topic.count({ where: { ...scope, status: "GENERATED" } }),
    db.article.count({ where: { ...scope, status: { in: ["READY_FOR_REVIEW", "APPROVED"] } } }),
    db.article.count({ where: { ...scope, status: "PUSH_FAILED" } }),
    user.role === "SUPER_ADMIN" ? db.accessRequest.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
    user.role !== "MEMBER" ? db.formSubmission.count({ where: { processedAt: null } }) : Promise.resolve(0),
    db.article.findMany({
      where: { ...scope, status: { in: ["READY_FOR_REVIEW", "APPROVED", "PUSH_FAILED"] } },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  ]);

  return (
    <>
      <PageHeader title={`Hi ${user.name.split(" ")[0]}`} subtitle="Everything waiting on you across your clients." />
      <div className="stagger mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Keywords to approve" value={pendingKeywords} icon="tag" />
        <Stat label="Topics to review" value={topicsToReview} icon="lightbulb" />
        <Stat label="Articles to review or push" value={articlesToReview} icon="file" />
        <Stat label="Failed pushes" value={failedPushes} icon="alert" alert />
        {user.role === "SUPER_ADMIN" && <Stat label="Access requests" value={openRequests} icon="key" href="/access" />}
        {user.role !== "MEMBER" && <Stat label="Intake errors" value={failedIntake} icon="zap" alert href="/intake" />}
      </div>

      <h2 className="mb-3 text-lg font-semibold">Articles</h2>
      {articles.length === 0 ? (
        <Empty>No articles are waiting on you.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr><th>Article</th><th>Client</th><th>Status</th><th>Arrived</th></tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id}>
                  <td><Link className="text-indigo-600 hover:underline" href={`/articles/${a.id}`}>{a.metaTitle}</Link></td>
                  <td>{a.client.name}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>{fmtDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

import { requireSuperAdmin } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { ImportForm } from "./form";

export const maxDuration = 60;

export default async function ImportPage() {
  await requireSuperAdmin();
  return (
    <>
      <PageHeader
        title="Import from Google Sheet"
        subtitle="Upload the Blog Automation sheet as .xlsx. Preview first, then import. Running it again skips what is already here."
      />
      <ImportForm />
    </>
  );
}

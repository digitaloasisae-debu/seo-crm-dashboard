import { requireSuperAdmin } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { ClientForm } from "@/components/client-form";
import { createClientAction } from "../../../actions";

export default async function NewClientPage() {
  await requireSuperAdmin();
  return (
    <>
      <PageHeader title="Add client" subtitle="Most clients arrive through the onboarding Tally form. Use this for manual setup. WordPress access is added on the next screen." />
      <ClientForm action={createClientAction} submitLabel="Create client" />
    </>
  );
}

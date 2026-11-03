import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { PasswordForm, ProfileForm } from "./forms";

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="My profile" subtitle={`Signed in as ${user.role.replace("_", " ").toLowerCase()}.`} />
      <div className="grid max-w-3xl gap-6 md:grid-cols-2">
        <ProfileForm name={user.name} email={user.email} />
        <PasswordForm />
      </div>
    </>
  );
}

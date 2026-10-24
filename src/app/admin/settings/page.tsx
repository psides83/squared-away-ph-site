import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { settingsFormValues } from "@/lib/business-settings";
import { BusinessSettingsForm } from "@/components/business-settings-form";
import { PageHeading } from "@/components/ui";

export default async function Settings() {
  const { db } = await requireAdmin();
  const { data, error } = await db
    .from("business_settings")
    .select("*")
    .single();
  return (
    <>
      <PageHeading
        eyebrow="YOUR BUSINESS, YOUR DEFAULTS"
        title="Business settings"
        description="Set the details once. Adjust each horse’s agreement when you need to."
      />
      <div className="row-actions">
        <Link className="button secondary" href="/admin/settings/notifications">
          Device notifications
        </Link>
      </div>
      {error || !data ? (
        <p className="notice error" role="alert">
          Business settings couldn’t load. Confirm the latest Supabase migration
          has completed, then refresh.
        </p>
      ) : (
        <>
          <p className="notice">
            Manage your business details, billing defaults, and payment links.
            Changes here set defaults for future records.
          </p>
          <BusinessSettingsForm initialValues={settingsFormValues(data)} />
        </>
      )}
    </>
  );
}

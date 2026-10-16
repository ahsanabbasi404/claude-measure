import { db } from "./db";

export type AccountInfo = {
  email?: string | null;
  account_uuid?: string | null;
  organization_type?: string | null;
  rate_limit_tier?: string | null;
  display_name?: string | null;
};

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Records a Claude account seen on a device; keeps the latest known plan tier. */
export async function upsertAccount(a: AccountInfo, deviceId: string | null, devName: string | null) {
  const email = clean(a.email)?.toLowerCase();
  if (!email) return;
  await db()`
    INSERT INTO accounts (user_email, account_uuid, organization_type, rate_limit_tier, display_name,
      last_seen, last_device_id, last_dev_name)
    VALUES (${email}, ${clean(a.account_uuid)}, ${clean(a.organization_type)}, ${clean(a.rate_limit_tier)},
      ${clean(a.display_name)}, now(), ${deviceId}, ${devName})
    ON CONFLICT (user_email) DO UPDATE SET
      account_uuid = coalesce(EXCLUDED.account_uuid, accounts.account_uuid),
      organization_type = coalesce(EXCLUDED.organization_type, accounts.organization_type),
      rate_limit_tier = coalesce(EXCLUDED.rate_limit_tier, accounts.rate_limit_tier),
      display_name = coalesce(EXCLUDED.display_name, accounts.display_name),
      last_seen = now(),
      last_device_id = coalesce(EXCLUDED.last_device_id, accounts.last_device_id),
      last_dev_name = coalesce(EXCLUDED.last_dev_name, accounts.last_dev_name)`;
}

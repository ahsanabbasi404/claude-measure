import { Suspense } from "react";
import AccountPage from "@/components/dashboard/account";

export default function Page() {
  return (
    <Suspense>
      <AccountPage />
    </Suspense>
  );
}

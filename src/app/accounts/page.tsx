import { Suspense } from "react";
import AccountsPage from "@/components/dashboard/accounts";

export default function Page() {
  return (
    <Suspense>
      <AccountsPage />
    </Suspense>
  );
}

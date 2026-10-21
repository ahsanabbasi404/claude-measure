import { Suspense } from "react";
import SessionsPage from "@/components/dashboard/sessions";

export default function Page() {
  return (
    <Suspense>
      <SessionsPage />
    </Suspense>
  );
}

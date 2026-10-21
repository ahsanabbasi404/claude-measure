import { Suspense } from "react";
import SessionPage from "@/components/dashboard/session";

export default function Page() {
  return (
    <Suspense>
      <SessionPage />
    </Suspense>
  );
}

import { Suspense } from "react";
import ReportPage from "@/components/dashboard/report";

export default function Page() {
  return (
    <Suspense>
      <ReportPage />
    </Suspense>
  );
}

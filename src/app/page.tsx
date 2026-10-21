import { Suspense } from "react";
import Overview from "@/components/dashboard/overview";

export default function Page() {
  return (
    <Suspense>
      <Overview />
    </Suspense>
  );
}

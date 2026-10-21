import { Suspense } from "react";
import PersonPage from "@/components/dashboard/person";

export default function Page() {
  return (
    <Suspense>
      <PersonPage />
    </Suspense>
  );
}

import { redirect } from "next/navigation"
import { UPI_IMPORT_HREF } from "@/components/statements/upi-links"

// The UPI import's first address (Sprint 9e): it now lives under Transactions.
export default function OldUpiImportPage() {
  redirect(UPI_IMPORT_HREF)
}

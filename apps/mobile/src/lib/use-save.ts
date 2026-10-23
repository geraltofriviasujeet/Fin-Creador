import type { WriteResult } from "@fin-creador/api";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useToast } from "@/components/toast";
import { NETWORK_ERROR, useIncome } from "./income-store";
import { useTransactions } from "./transactions-store";

/**
 * Runs a shared writer from a sheet. On success: toast, refresh the Income and Activity data, close the
 * sheet. On failure the sheet stays open with the messages, and its inputs (including the
 * income request key) are kept for the retry. Offline is a retryable error, never a crash.
 */
export function useSave() {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useIncome();
  const { refresh: refreshTransactions } = useTransactions();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WriteResult | null>(null);

  const save = useCallback(
    async (write: () => Promise<WriteResult>, { close = true }: { close?: boolean } = {}) => {
      setBusy(true);
      try {
        const r = await write();
        setResult(r);
        if (r.status === "success") {
          toast.show(r.message);
          void refresh();
          void refreshTransactions();
          if (close) router.back();
        }
        return r;
      } catch {
        const r: WriteResult = { status: "error", message: NETWORK_ERROR };
        setResult(r);
        return r;
      } finally {
        setBusy(false);
      }
    },
    [refresh, refreshTransactions, router, toast]
  );

  const fieldErrors = result?.status === "error" ? (result.fieldErrors ?? {}) : {};
  const formError = result?.status === "error" ? result.message : null;
  return { save, busy, fieldErrors, formError };
}

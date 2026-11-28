import * as WebBrowser from "expo-web-browser";
import { ExternalLink } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheet, Button } from "@/components/ds";
import { getPublicEnv } from "@/lib/env";
import { dsText, mobile, spacing } from "@/theme";

// Import UPI on the phone (Sprint 13b PR 5; decisions log 2026-11-24): the statement import runs on
// the web for now, so Activity's header and Home's quick action open this sheet, which opens the
// web's import page in the in-app browser. The path matches the web's UPI_IMPORT_HREF
// (apps/web/components/statements/upi-links.ts); a signed-out browser goes through sign-in first.
export const UPI_IMPORT_PATH = "/transactions/import/upi";

export function importUpiUrl(webUrl: string): string {
  return `${webUrl.replace(/\/+$/, "")}${UPI_IMPORT_PATH}`;
}

export function ImportUpiSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const close = () => {
    setFailed(false);
    onClose();
  };
  const open = async () => {
    setFailed(false);
    try {
      await WebBrowser.openBrowserAsync(importUpiUrl(getPublicEnv().webUrl));
      close();
    } catch {
      setFailed(true);
    }
  };
  return (
    <BottomSheet visible={visible} title="Import UPI" onClose={close}>
      <View style={styles.body}>
        <Text style={dsText.bodyStrong}>Import UPI is on the web for now</Text>
        <Text style={dsText.body}>
          Upload a Paytm, PhonePe, BHIM or Google Pay statement PDF on the FinCreador website and choose what to save. The entries then show here in
          Activity.
        </Text>
        {failed ? (
          <Text accessibilityRole="alert" style={styles.error}>
            We couldn&apos;t open the browser. Please try again.
          </Text>
        ) : null}
        <Button label="Open on the web" icon={ExternalLink} fullWidth onPress={() => void open()} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing[3] },
  error: { ...dsText.caption, color: mobile.colors.warning },
});

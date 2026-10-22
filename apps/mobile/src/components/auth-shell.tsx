import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/card";
import { Logo } from "@/components/logo";
import { Screen } from "@/components/screen";
import { colors, spacing, text } from "@/theme";

type Props = { title: string; description: string; children: ReactNode; footer?: ReactNode };

/** Logo above a centred card, as on the web auth pages. */
export function AuthShell({ title, description, children, footer }: Props) {
  return (
    <Screen edges={["top", "bottom"]} centered>
      <View style={styles.logo}>
        <Logo tone="onLight" />
      </View>
      <Card style={styles.card}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={text.pageTitle}>
            {title}
          </Text>
          <Text style={text.bodySmall}>{description}</Text>
        </View>
        {children}
      </Card>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Screen>
  );
}

/** "or" separator between the email form and Google. */
export function OrDivider() {
  return (
    <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.rule} />
      <Text style={text.caption}>or</Text>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { alignItems: "center", marginBottom: spacing[2] },
  card: { gap: spacing[4] },
  heading: { gap: spacing[1] },
  footer: { alignItems: "center" },
  divider: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  rule: { flex: 1, height: 1, backgroundColor: colors.line },
});

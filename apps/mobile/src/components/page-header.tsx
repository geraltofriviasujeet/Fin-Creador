import { StyleSheet, Text, View } from "react-native";
import { spacing, text } from "@/theme";

/**
 * A page's title and description. Leave `title` out on stack screens (Income, Recurring):
 * their navigation bar already shows it, so a second title would repeat it.
 */
export function PageHeader({ title, description }: { title?: string; description?: string }) {
  return (
    <View style={styles.header}>
      {title ? (
        <Text accessibilityRole="header" style={text.pageTitle}>
          {title}
        </Text>
      ) : null}
      {description ? <Text style={text.bodySmall}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({ header: { gap: spacing[1] } });

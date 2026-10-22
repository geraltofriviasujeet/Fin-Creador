import { StyleSheet, Text, View } from "react-native";
import { spacing, text } from "@/theme";

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={text.pageTitle}>
        {title}
      </Text>
      {description ? <Text style={text.bodySmall}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({ header: { gap: spacing[1] } });

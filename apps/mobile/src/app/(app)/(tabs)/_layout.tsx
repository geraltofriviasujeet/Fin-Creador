import { layout } from "@fin-creador/design-tokens";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppHeader } from "@/components/app-header";
import { TABS } from "@/navigation";
import { colors, fontFamily, fontSize } from "@/theme";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        header: () => <AppHeader />,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.xs },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          height: layout.tabBarHeight + insets.bottom,
          paddingTop: 6,
        },
      }}
    >
      {TABS.map(({ name, label, icon: Icon, available }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: label,
            tabBarAccessibilityLabel: available ? label : `${label}, coming soon`,
            tabBarIcon: ({ color, focused }) => <Icon size={22} color={color} strokeWidth={focused ? 2.25 : 1.75} />,
          }}
        />
      ))}
    </Tabs>
  );
}

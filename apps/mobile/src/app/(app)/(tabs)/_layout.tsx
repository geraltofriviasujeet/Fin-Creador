import { Tabs, useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { AppHeader } from "@/components/app-header";
import { TabBar } from "@/components/ds";
import { ADD_ENTRY, TAB_ROUTES, tabForRoute } from "@/navigation";
import { colors } from "@/theme";

type TabBarRenderer = NonNullable<ComponentProps<typeof Tabs>["tabBar"]>;

// Home · Activity · ＋ · Plan · Roma (design-spec §5), drawn by the design-system TabBar. The
// ＋ opens Add; the four tabs switch screens the same way the default bar does (tabPress
// event first, so a screen can still react to a re-tap).
export default function TabsLayout() {
  const router = useRouter();
  const renderTabBar: TabBarRenderer = ({ state, emitter, navigateToTab }) => (
    <TabBar
      active={tabForRoute(state.routes[state.index]?.name)}
      onAdd={() => router.push(ADD_ENTRY)}
      onSelect={(key) => {
        const route = state.routes.find((r) => r.name === TAB_ROUTES[key]);
        if (!route) return;
        const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (!event.defaultPrevented && state.routes[state.index]?.key !== route.key) navigateToTab(route.key);
      }}
    />
  );
  return (
    <Tabs tabBar={renderTabBar} screenOptions={{ header: () => <AppHeader />, sceneStyle: { backgroundColor: colors.canvas } }}>
      {/* Home, Activity and Plan draw their own headers (Home: avatar menu, greeting, bell; Activity: Search and Import UPI; Plan: bell and Settings). */}
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false }} />
      <Tabs.Screen name="activity" options={{ title: "Activity", headerShown: false }} />
      <Tabs.Screen name="plan" options={{ title: "Plan", headerShown: false }} />
      <Tabs.Screen name="roma" options={{ title: "Roma" }} />
    </Tabs>
  );
}

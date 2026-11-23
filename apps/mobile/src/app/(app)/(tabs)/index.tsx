import { formatClockTime } from "@fin-creador/domain";
import { useFocusEffect, useRouter } from "expo-router";
import { CircleAlert, CloudOff, Landmark } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { Button, EmptyState, OfflineBanner, WarningBanner } from "@/components/ds";
import { HomeHeader } from "@/components/home/home-header";
import { AskRomaCard, ComingUp, HeroCard, HomeSkeleton, QuickActions, WhereItWent, YourMoney } from "@/components/home/sections";
import { Screen } from "@/components/screen";
import { useHomeData } from "@/lib/home-data";
import { mobile, spacing } from "@/theme";

// Home (Sprint 13a PR 4, design-spec §5): greeting, Safe to spend, quick actions, Coming up,
// Where it went, Your money and Ask Roma. Loads on every visit (after an entry is saved the
// sheet closes and Home comes back into focus). Data stays in memory only.
export default function HomeScreen() {
  const router = useRouter();
  const { state, refresh } = useHomeData();
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const now = new Date();
  const ready = state.status === "ready" ? state : null;
  const header = (
    <HomeHeader
      profile={ready ? { name: ready.data.name, timeZone: ready.data.timeZone } : null}
      reminders={ready ? ready.data.reminders : null}
      now={now}
    />
  );

  let body;
  if (state.status === "loading") {
    body = <HomeSkeleton />;
  } else if (state.status === "offline") {
    body = (
      <EmptyState
        icon={CloudOff}
        title="You're offline"
        body="Home will load when your phone is back online."
        action={{ label: "Try again", onPress: () => void refresh() }}
      />
    );
  } else if (state.status === "error") {
    body = <EmptyState icon={CircleAlert} title="We couldn't load Home" body={state.message} action={{ label: "Retry", onPress: () => void refresh() }} />;
  } else if (state.data.isNew) {
    body = (
      <>
        <EmptyState
          icon={Landmark}
          title="Start with an account"
          body="Add the bank account or cash you spend from. Safe to spend, bills and your money show up here as you record them."
          action={{ label: "Add an account", onPress: () => router.push({ pathname: "/sheets/account", params: { kind: "bank" } }) }}
        />
        <View style={styles.secondary}>
          <Button label="Add expense" variant="secondary" onPress={() => router.push({ pathname: "/sheets/transaction", params: { type: "expense" } })} />
        </View>
      </>
    );
  } else {
    const { data, problem, loadedAt } = state;
    body = (
      <>
        {problem === "offline" ? <OfflineBanner detail={`Showing what was loaded at ${formatClockTime(loadedAt, data.timeZone)}.`} /> : null}
        {problem === "error" ? <WarningBanner message="We couldn't refresh Home. Showing what was loaded earlier." action={{ label: "Retry", onPress: () => void refresh() }} /> : null}
        <HeroCard home={data} />
        <QuickActions />
        <ComingUp home={data} />
        <WhereItWent home={data} />
        <YourMoney home={data} />
        <AskRomaCard />
      </>
    );
  }

  return (
    <View style={styles.page}>
      {header}
      <Screen refreshControl={<RefreshControl refreshing={ready?.refreshing ?? false} onRefresh={() => void refresh()} />}>{body}</Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: mobile.colors.canvas },
  secondary: { alignItems: "center", marginTop: -spacing[4] },
});

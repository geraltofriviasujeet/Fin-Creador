import { Pencil, Undo2, type LucideIcon } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "@/components/ds";
import { fontFamily, mobile, spacing } from "@/theme";

// Swipe a row left for Edit and Void (Sprint 13b PR 5; decisions log 2026-11-24: React Native's
// own gestures, no new dependency). The same two actions are accessibility actions on the row,
// so screen-reader and switch users never need the swipe. One row is open at a time (the screen
// holds which); tapping an open row closes it instead of opening its details.

const ACTION_WIDTH = 76;
const OPEN_X = -ACTION_WIDTH * 2;
/** A horizontal move this far (and clearly more sideways than up or down) starts a swipe. */
const START_SLOP = 10;
/** A click that ends a mouse drag on Expo web arrives within a few ms of the release: ignore it. */
const TAP_AFTER_SWIPE_MS = 100;

type Props = {
  /** False for a voided entry: it can't be edited or voided. */
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onVoid: () => void;
  /** The row; wrap its press handler with `guard` so a swipe never also opens the row. */
  children: (guard: (onPress: () => void) => () => void) => ReactNode;
};

/** The gesture's state, kept outside React's render: one per row, made once. */
class SwipeState {
  offset = 0;
  private start = 0;
  private swipedAt = 0;
  private enabled = true;
  private reduceMotion = false;
  private onOpenChange: (open: boolean) => void = () => undefined;
  readonly pan;

  constructor(
    readonly x: Animated.Value,
    private readonly setRevealed: (revealed: boolean) => void,
  ) {
    this.pan = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => this.enabled && Math.abs(g.dx) > START_SLOP && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        this.start = this.offset;
        this.setRevealed(true);
      },
      // A little give past the open end, none past closed.
      onPanResponderMove: (_, g) => this.x.setValue(Math.max(OPEN_X - 24, Math.min(0, this.start + g.dx))),
      onPanResponderRelease: (_, g) => {
        this.swipedAt = Date.now();
        const end = this.start + g.dx;
        const opening = g.vx < -0.4 || (g.vx <= 0.4 && end < OPEN_X / 2);
        this.settle(opening ? OPEN_X : 0);
        this.onOpenChange(opening);
      },
      onPanResponderTerminate: () => this.settle(this.start),
      onPanResponderTerminationRequest: () => false,
    });
  }

  update(p: { enabled: boolean; reduceMotion: boolean; onOpenChange: (open: boolean) => void }) {
    this.enabled = p.enabled;
    this.reduceMotion = p.reduceMotion;
    this.onOpenChange = p.onOpenChange;
  }

  settle(to: number) {
    this.offset = to;
    const done = () => {
      if (this.offset === 0) this.setRevealed(false);
    };
    if (this.reduceMotion) {
      this.x.setValue(to);
      done();
      return;
    }
    Animated.timing(this.x, { toValue: to, duration: 180, useNativeDriver: Platform.OS !== "web" }).start(({ finished }) => finished && done());
  }

  /** A tap on the row: ignored right after a swipe, closes an open row, otherwise opens it. */
  press(onPress: () => void) {
    if (Date.now() - this.swipedAt < TAP_AFTER_SWIPE_MS) return;
    if (this.offset !== 0) {
      this.settle(0);
      this.onOpenChange(false);
      return;
    }
    onPress();
  }
}

export function SwipeRow({ enabled, open, onOpenChange, onEdit, onVoid, children }: Props) {
  const reduceMotion = useReducedMotion();
  // The actions are only mounted while the row is (being) moved, so a closed row has no hidden buttons.
  const [revealed, setRevealed] = useState(false);
  const [swipe] = useState(() => new SwipeState(new Animated.Value(0), setRevealed));

  useEffect(() => {
    swipe.update({ enabled, reduceMotion, onOpenChange });
  }, [swipe, enabled, reduceMotion, onOpenChange]);

  // The screen closed this row (another one opened, or an action ran).
  useEffect(() => {
    if (!open && swipe.offset !== 0) swipe.settle(0);
  }, [open, swipe]);

  return (
    <View style={styles.wrap}>
      {revealed ? (
        <View style={styles.actions} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"}>
          <Action icon={Pencil} label="Edit" tone="forest" onPress={onEdit} />
          <Action icon={Undo2} label="Void" tone="warning" onPress={onVoid} />
        </View>
      ) : null}
      <Animated.View style={[styles.front, { transform: [{ translateX: swipe.x }] }]} {...swipe.pan.panHandlers}>
        {children((onPress) => () => swipe.press(onPress))}
      </Animated.View>
    </View>
  );
}

function Action({ icon: Icon, label, tone, onPress }: { icon: LucideIcon; label: string; tone: "forest" | "warning"; onPress: () => void }) {
  const fg = tone === "forest" ? mobile.colors.onForest : mobile.colors.surface;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, tone === "forest" ? styles.forest : styles.warning, pressed && styles.pressed]}
    >
      <Icon size={20} color={fg} />
      <Text style={[styles.actionText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** The row's accessibility actions: the swipe's Edit and Void without swiping. */
export const SWIPE_ACCESSIBILITY_ACTIONS = [
  { name: "edit", label: "Edit" },
  { name: "void", label: "Void" },
] as const;

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", borderRadius: mobile.radius.tile },
  front: { backgroundColor: mobile.colors.surface },
  actions: { position: "absolute", top: 0, bottom: 0, right: 0, flexDirection: "row" },
  action: { width: ACTION_WIDTH, alignItems: "center", justifyContent: "center", gap: spacing[1] },
  forest: { backgroundColor: mobile.colors.forest },
  warning: { backgroundColor: mobile.colors.warning },
  pressed: { opacity: 0.8 },
  actionText: { fontFamily: fontFamily.bodySemibold, fontSize: mobile.type.caption.size },
});

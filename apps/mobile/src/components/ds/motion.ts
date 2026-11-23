import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** True when the person has asked the OS to reduce motion; components then skip animation. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

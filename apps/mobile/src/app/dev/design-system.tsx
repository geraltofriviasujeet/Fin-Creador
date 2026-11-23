import { Redirect } from "expo-router";
import type { ComponentType } from "react";

// Design-system preview route (Sprint 12c), development builds only.
// Expo Router bundles every file under app/, so this file is a stub: the preview module is
// required only inside `if (__DEV__)`. In a production build Metro inlines __DEV__ as false,
// drops the branch and never collects the dependency, so the preview's code is not in the
// bundle. The root layout also guards this route with Stack.Protected guard={__DEV__}.
// CI checks the production bundles: scripts/check-mobile-preview-excluded.mjs.

let Screen: ComponentType = function NotInProduction() {
  return <Redirect href="/" />;
};

if (__DEV__) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Screen = require("@/dev/design-system-preview").DesignSystemPreview;
}

export default Screen;

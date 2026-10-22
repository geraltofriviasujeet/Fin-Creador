import { describe, expect, it, vi } from "vitest";

// auth-actions imports native modules; stub them so the pure helper can be tested in Node.
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo-linking", () => ({}));
vi.mock("expo-web-browser", () => ({}));
vi.mock("./supabase", () => ({}));
vi.mock("./env", () => ({}));

const { hasIpHost } = await import("./auth-actions");

describe("hasIpHost (Supabase rejects IP-literal redirect hosts)", () => {
  it.each(["exp://192.168.1.6:8081/--/auth/callback", "exp://10.0.0.2/--/x", "exp://[::1]:8081/--/x"])("flags %s", (url) => {
    expect(hasIpHost(url)).toBe(true);
  });

  it.each([
    "exp://abc-anonymous-8081.exp.direct/--/auth/callback",
    "exp://localhost:8081/--/auth/callback",
    "fincreador://auth/callback",
  ])("allows %s", (url) => {
    expect(hasIpHost(url)).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerCoiServiceWorker } from "./coi";

describe("registerCoiServiceWorker", () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    // Reset any registered flag from a previous test
    (globalThis as Record<string, unknown>).__coiRegistered = undefined;
  });

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("registers the SW and resolves when serviceWorker.controller is set", async () => {
    const register = vi.fn().mockResolvedValue({
      active: {},
      installing: null,
      waiting: null,
      scope: "/",
      update: vi.fn(),
      unregister: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onupdatefound: null,
    });
    Object.defineProperty(global, "navigator", {
      value: { serviceWorker: { register: register } },
      writable: true,
      configurable: true,
    });

    await expect(registerCoiServiceWorker()).resolves.toBeUndefined();
    expect(register).toHaveBeenCalledWith("/coi-serviceworker.js");
  });

  it("does nothing if serviceWorker is unavailable", async () => {
    Object.defineProperty(global, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
    await expect(registerCoiServiceWorker()).resolves.toBeUndefined();
  });

  it("does not throw if registration fails", async () => {
    const register = vi.fn().mockRejectedValue(new Error("blocked"));
    Object.defineProperty(global, "navigator", {
      value: { serviceWorker: { register: register } },
      writable: true,
      configurable: true,
    });
    await expect(registerCoiServiceWorker()).resolves.toBeUndefined();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { isTrackingEnabled } from "../../src/usage/constants.js";
import { withCleanEnv } from "../helpers.js";

describe("isTrackingEnabled", () => {
  const { restore } = withCleanEnv();

  afterEach(() => {
    restore();
  });

  it("returns true when env var is not set", () => {
    delete process.env.ARCADE_USAGE_TRACKING;
    expect(isTrackingEnabled()).toBe(true);
  });

  it("returns true for '1'", () => {
    process.env.ARCADE_USAGE_TRACKING = "1";
    expect(isTrackingEnabled()).toBe(true);
  });

  it("returns true for 'true'", () => {
    process.env.ARCADE_USAGE_TRACKING = "true";
    expect(isTrackingEnabled()).toBe(true);
  });

  it("returns false for '0'", () => {
    process.env.ARCADE_USAGE_TRACKING = "0";
    expect(isTrackingEnabled()).toBe(false);
  });

  it("returns false for 'false'", () => {
    process.env.ARCADE_USAGE_TRACKING = "false";
    expect(isTrackingEnabled()).toBe(false);
  });

  it("returns false for 'no'", () => {
    process.env.ARCADE_USAGE_TRACKING = "no";
    expect(isTrackingEnabled()).toBe(false);
  });

  it("returns false for 'off'", () => {
    process.env.ARCADE_USAGE_TRACKING = "off";
    expect(isTrackingEnabled()).toBe(false);
  });

  it("returns false for 'OFF' (case-insensitive)", () => {
    process.env.ARCADE_USAGE_TRACKING = "OFF";
    expect(isTrackingEnabled()).toBe(false);
  });
});

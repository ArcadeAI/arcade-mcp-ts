import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageIdentity } from "../../src/usage/identity.js";

describe("UsageIdentity", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `arcade-usage-test-${Date.now()}`);
    mkdirSync(join(testDir, ".arcade"), { recursive: true });
    process.env.ARCADE_WORK_DIR = testDir;
  });

  afterEach(() => {
    delete process.env.ARCADE_WORK_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("generates a new UUID on first use", () => {
    const identity = new UsageIdentity();
    expect(identity.anonymousId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("persists identity to disk", () => {
    const identity = new UsageIdentity();
    const filePath = join(testDir, ".arcade", "usage.json");
    expect(existsSync(filePath)).toBe(true);

    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data.anonymous_id).toBe(identity.anonymousId);
  });

  it("reuses existing identity from disk", () => {
    const first = new UsageIdentity();
    const second = new UsageIdentity();
    expect(second.anonymousId).toBe(first.anonymousId);
  });

  it("getDistinctId returns anonymous_id when no principal linked", () => {
    const identity = new UsageIdentity();
    expect(identity.getDistinctId()).toBe(identity.anonymousId);
  });

  it("linkPrincipal persists and changes distinctId", () => {
    const identity = new UsageIdentity();
    const anonId = identity.anonymousId;

    identity.linkPrincipal("user@example.com");
    expect(identity.getDistinctId()).toBe("user@example.com");
    expect(identity.linkedPrincipalId).toBe("user@example.com");

    // Verify persisted
    const second = new UsageIdentity();
    expect(second.anonymousId).toBe(anonId);
    expect(second.linkedPrincipalId).toBe("user@example.com");
    expect(second.getDistinctId()).toBe("user@example.com");
  });

  it("shouldAlias returns true when principal is linked", () => {
    const identity = new UsageIdentity();
    expect(identity.shouldAlias()).toBe(false);

    identity.linkPrincipal("user@example.com");
    expect(identity.shouldAlias()).toBe(true);
  });

  it("handles corrupt JSON gracefully", () => {
    const filePath = join(testDir, ".arcade", "usage.json");
    writeFileSync(filePath, "not valid json!!!", "utf-8");

    const identity = new UsageIdentity();
    expect(identity.anonymousId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("handles missing anonymous_id in JSON", () => {
    const filePath = join(testDir, ".arcade", "usage.json");
    writeFileSync(filePath, JSON.stringify({ foo: "bar" }), "utf-8");

    const identity = new UsageIdentity();
    expect(identity.anonymousId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

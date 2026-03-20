import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../../src/exceptions.js";
import { ComponentRegistry } from "../../src/managers/base.js";

describe("ComponentRegistry", () => {
  it("starts empty with version 0", () => {
    const reg = new ComponentRegistry<string, number>();
    expect(reg.size).toBe(0);
    expect(reg.version).toBe(0);
    expect(reg.keys()).toEqual([]);
    expect(reg.values()).toEqual([]);
  });

  it("upserts and retrieves values", () => {
    const reg = new ComponentRegistry<string, string>();
    reg.upsert("a", "alpha");
    reg.upsert("b", "beta");

    expect(reg.get("a")).toBe("alpha");
    expect(reg.get("b")).toBe("beta");
    expect(reg.get("c")).toBeUndefined();
    expect(reg.has("a")).toBe(true);
    expect(reg.has("c")).toBe(false);
    expect(reg.size).toBe(2);
  });

  it("bumps version on upsert", () => {
    const reg = new ComponentRegistry<string, string>();
    expect(reg.version).toBe(0);
    reg.upsert("a", "alpha");
    expect(reg.version).toBe(1);
    reg.upsert("a", "updated");
    expect(reg.version).toBe(2);
    expect(reg.get("a")).toBe("updated");
  });

  it("removes values and bumps version", () => {
    const reg = new ComponentRegistry<string, string>();
    reg.upsert("a", "alpha");
    reg.upsert("b", "beta");

    const removed = reg.remove("a");
    expect(removed).toBe("alpha");
    expect(reg.has("a")).toBe(false);
    expect(reg.size).toBe(1);
    expect(reg.version).toBe(3);
  });

  it("throws NotFoundError on removing non-existent key", () => {
    const reg = new ComponentRegistry<string, string>();
    expect(() => reg.remove("missing")).toThrow(NotFoundError);
    expect(() => reg.remove("missing")).toThrow("Key not found");
  });

  it("returns keys sorted deterministically", () => {
    const reg = new ComponentRegistry<string, string>();
    reg.upsert("c", "charlie");
    reg.upsert("a", "alpha");
    reg.upsert("b", "beta");

    expect(reg.keys()).toEqual(["a", "b", "c"]);
  });

  it("returns values sorted by key", () => {
    const reg = new ComponentRegistry<string, string>();
    reg.upsert("c", "charlie");
    reg.upsert("a", "alpha");
    reg.upsert("b", "beta");

    expect(reg.values()).toEqual(["alpha", "beta", "charlie"]);
  });

  it("bulk loads items with single version bump", () => {
    const reg = new ComponentRegistry<string, string>();
    reg.bulkLoad([
      ["a", "alpha"],
      ["b", "beta"],
      ["c", "charlie"],
    ]);

    expect(reg.size).toBe(3);
    expect(reg.version).toBe(1);
    expect(reg.get("b")).toBe("beta");
  });

  it("notifies subscribers on upsert", () => {
    const reg = new ComponentRegistry<string, string>();
    const subscriber = vi.fn();
    reg.subscribe(subscriber);

    reg.upsert("a", "alpha");

    expect(subscriber).toHaveBeenCalledWith(
      "upsert",
      "a",
      undefined,
      "alpha",
      1,
    );
  });

  it("notifies subscribers with old value on update", () => {
    const reg = new ComponentRegistry<string, string>();
    reg.upsert("a", "alpha");

    const subscriber = vi.fn();
    reg.subscribe(subscriber);

    reg.upsert("a", "updated");

    expect(subscriber).toHaveBeenCalledWith(
      "upsert",
      "a",
      "alpha",
      "updated",
      2,
    );
  });

  it("notifies subscribers on remove", () => {
    const reg = new ComponentRegistry<string, string>();
    reg.upsert("a", "alpha");

    const subscriber = vi.fn();
    reg.subscribe(subscriber);

    reg.remove("a");

    expect(subscriber).toHaveBeenCalledWith(
      "remove",
      "a",
      "alpha",
      undefined,
      2,
    );
  });

  it("notifies subscribers on bulk load", () => {
    const reg = new ComponentRegistry<string, string>();
    const subscriber = vi.fn();
    reg.subscribe(subscriber);

    reg.bulkLoad([["a", "alpha"]]);

    expect(subscriber).toHaveBeenCalledWith(
      "bulk_load",
      undefined,
      undefined,
      undefined,
      1,
    );
  });
});

import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../src/exceptions.js";
import { ResourceManager } from "../../src/managers/resource-manager.js";

describe("ResourceManager", () => {
  it("adds and lists resources", () => {
    const rm = new ResourceManager();
    rm.addResource("file:///config.json", "config", {
      description: "App config",
    });
    rm.addResource("file:///data.csv", "data", {
      description: "Data file",
      mimeType: "text/csv",
    });

    const resources = rm.listResources();
    expect(resources).toHaveLength(2);
    expect(rm.getResourceUris()).toEqual([
      "file:///config.json",
      "file:///data.csv",
    ]);
  });

  it("removes a resource", () => {
    const rm = new ResourceManager();
    rm.addResource("file:///config.json", "config", {
      description: "App config",
    });

    const removed = rm.removeResource("file:///config.json");
    expect(removed.name).toBe("config");
    expect(rm.listResources()).toHaveLength(0);
  });

  it("throws when removing non-existent resource", () => {
    const rm = new ResourceManager();
    expect(() => rm.removeResource("file:///missing")).toThrow("Key not found");
  });

  it("calls handler with URI", async () => {
    const rm = new ResourceManager();
    rm.addResource(
      "file:///config.json",
      "config",
      { description: "Config", mimeType: "application/json" },
      (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: '{"key": "value"}',
          },
        ],
      }),
    );

    const result = await rm.readResource("file:///config.json");
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toEqual({
      uri: "file:///config.json",
      mimeType: "application/json",
      text: '{"key": "value"}',
    });
  });

  it("throws NotFoundError when reading non-existent resource", async () => {
    const rm = new ResourceManager();
    await expect(rm.readResource("file:///missing")).rejects.toThrow(
      NotFoundError,
    );
    await expect(rm.readResource("file:///missing")).rejects.toThrow(
      "Resource 'file:///missing' not found",
    );
  });

  it("uses default handler returning empty text", async () => {
    const rm = new ResourceManager();
    rm.addResource("file:///empty", "empty", { description: "Empty" });

    const result = await rm.readResource("file:///empty");
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toEqual({
      uri: "file:///empty",
      text: "",
      mimeType: "text/plain",
    });
  });

  it("supports async handlers", async () => {
    const rm = new ResourceManager();
    rm.addResource(
      "file:///async",
      "async",
      { description: "Async resource" },
      async (uri) => ({
        contents: [{ uri: uri.href, text: "async content" }],
      }),
    );

    const result = await rm.readResource("file:///async");
    expect(result.contents[0].text).toBe("async content");
  });
});

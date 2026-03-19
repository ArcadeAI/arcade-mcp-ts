import { describe, expect, it } from "vitest";
import { InMemoryEventStore } from "../src/event-store.js";

describe("InMemoryEventStore", () => {
  it("stores and replays events", async () => {
    const store = new InMemoryEventStore();
    const streamId = "stream-1";

    const id1 = await store.storeEvent(streamId, {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { data: "first" },
    });
    const id2 = await store.storeEvent(streamId, {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { data: "second" },
    });
    const id3 = await store.storeEvent(streamId, {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { data: "third" },
    });

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id3).toBeTruthy();

    // Replay after the first event — should get second and third
    const replayed: Array<{ eventId: string; message: unknown }> = [];
    const resultStreamId = await store.replayEventsAfter(id1, {
      send: async (eventId, message) => {
        replayed.push({ eventId, message });
      },
    });

    expect(resultStreamId).toBe(streamId);
    expect(replayed).toHaveLength(2);
    expect(replayed[0].eventId).toBe(id2);
    expect(replayed[1].eventId).toBe(id3);
  });

  it("returns empty stream ID for unknown last event", async () => {
    const store = new InMemoryEventStore();

    const replayed: unknown[] = [];
    const resultStreamId = await store.replayEventsAfter("nonexistent", {
      send: async (_eventId, message) => {
        replayed.push(message);
      },
    });

    expect(resultStreamId).toBe("");
    expect(replayed).toHaveLength(0);
  });

  it("returns empty stream ID for empty last event ID", async () => {
    const store = new InMemoryEventStore();

    const resultStreamId = await store.replayEventsAfter("", {
      send: async () => {},
    });

    expect(resultStreamId).toBe("");
  });

  it("only replays events from the same stream", async () => {
    const store = new InMemoryEventStore();

    const idA = await store.storeEvent("stream-a", {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { data: "a1" },
    });
    await store.storeEvent("stream-b", {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { data: "b1" },
    });
    await store.storeEvent("stream-a", {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { data: "a2" },
    });

    const replayed: Array<{ eventId: string; message: unknown }> = [];
    await store.replayEventsAfter(idA, {
      send: async (eventId, message) => {
        replayed.push({ eventId, message });
      },
    });

    expect(replayed).toHaveLength(1);
    expect(
      (replayed[0].message as { params: { data: string } }).params.data,
    ).toBe("a2");
  });

  it("replays nothing when last event is the final event", async () => {
    const store = new InMemoryEventStore();
    const streamId = "stream-1";

    await store.storeEvent(streamId, {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { data: "first" },
    });
    const lastId = await store.storeEvent(streamId, {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { data: "last" },
    });

    const replayed: unknown[] = [];
    await store.replayEventsAfter(lastId, {
      send: async (_eventId, message) => {
        replayed.push(message);
      },
    });

    expect(replayed).toHaveLength(0);
  });
});

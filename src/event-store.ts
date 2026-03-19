/**
 * Event store for resumable HTTP streams.
 *
 * Re-exports the SDK's EventStore interface and provides an in-memory
 * implementation suitable for single-process deployments.
 */

export type {
  EventId,
  EventStore,
  StreamId,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type {
  EventId,
  EventStore,
  StreamId,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * In-memory event store for stream resumability.
 *
 * Stores SSE events in memory so disconnected clients can resume via the
 * `Last-Event-ID` header. Suitable for development and single-process
 * deployments. For production use with multiple servers, implement the
 * `EventStore` interface with a persistent backend (e.g., Redis).
 */
export class InMemoryEventStore implements EventStore {
  private events = new Map<
    EventId,
    { streamId: StreamId; message: JSONRPCMessage }
  >();
  private sequence = 0;

  private generateEventId(streamId: StreamId): EventId {
    return `${streamId}_${String(this.sequence++).padStart(10, "0")}`;
  }

  private getStreamIdFromEventId(eventId: EventId): StreamId {
    const parts = eventId.split("_");
    return parts.length > 0 ? parts[0] : "";
  }

  async storeEvent(
    streamId: StreamId,
    message: JSONRPCMessage,
  ): Promise<EventId> {
    const eventId = this.generateEventId(streamId);
    this.events.set(eventId, { streamId, message });
    return eventId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    {
      send,
    }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    if (!lastEventId || !this.events.has(lastEventId)) {
      return "";
    }

    const streamId = this.getStreamIdFromEventId(lastEventId);
    if (!streamId) {
      return "";
    }

    let foundLastEvent = false;
    const sortedEvents = [...this.events.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    for (const [
      eventId,
      { streamId: eventStreamId, message },
    ] of sortedEvents) {
      if (eventStreamId !== streamId) {
        continue;
      }
      if (eventId === lastEventId) {
        foundLastEvent = true;
        continue;
      }
      if (foundLastEvent) {
        await send(eventId, message);
      }
    }

    return streamId;
  }
}

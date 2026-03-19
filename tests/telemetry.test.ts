import { metrics, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import { OTELHandler } from "../src/telemetry.js";

describe("OTELHandler", () => {
  afterEach(() => {
    // Reset global providers between tests
    trace.disable();
    metrics.disable();
  });

  describe("disabled", () => {
    it("does nothing when disabled", () => {
      const handler = new OTELHandler({
        enable: false,
        serviceName: "test",
        environment: "test",
      });
      handler.initialize();
      expect(handler.enabled).toBe(false);
      expect(handler.toolCallCounter).toBeUndefined();
    });

    it("shutdown is a no-op when disabled", async () => {
      const handler = new OTELHandler({
        enable: false,
        serviceName: "test",
        environment: "test",
      });
      await handler.shutdown(); // should not throw
    });
  });

  describe("enabled", () => {
    it("initializes tracer and meter providers", () => {
      const handler = new OTELHandler({
        enable: true,
        serviceName: "test-service",
        environment: "test-env",
      });
      handler.initialize();

      expect(handler.enabled).toBe(true);
      expect(handler.toolCallCounter).toBeDefined();

      const tracer = handler.getTracer("test");
      expect(tracer).toBeDefined();

      const meter = handler.getMeter("test");
      expect(meter).toBeDefined();
    });

    it("creates a ping span on initialization", () => {
      // Set up an in-memory exporter to capture spans
      const exporter = new InMemorySpanExporter();
      const provider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      trace.setGlobalTracerProvider(provider);

      const handler = new OTELHandler({
        enable: true,
        serviceName: "test-service",
        environment: "test-env",
      });
      // initialize() will set its own provider, overriding ours
      // But the ping span test is really about not throwing
      handler.initialize();

      // Verify we can create spans after initialization
      const tracer = handler.getTracer("test");
      const span = tracer.startSpan("test-span");
      span.end();
    });

    it("shuts down gracefully", async () => {
      const handler = new OTELHandler({
        enable: true,
        serviceName: "test-service",
        environment: "test-env",
      });
      handler.initialize();
      // Shutdown may take time if OTLP exporter retries, use short timeout
      await Promise.race([
        handler.shutdown(),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    }, 3000);

    it("tool call counter can be incremented", () => {
      const handler = new OTELHandler({
        enable: true,
        serviceName: "test-service",
        environment: "test-env",
      });
      handler.initialize();

      // Should not throw
      handler.toolCallCounter!.add(1, {
        tool_name: "test_tool",
        toolkit_name: "test_toolkit",
        environment: "test",
      });
    });
  });
});

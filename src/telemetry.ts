/**
 * OpenTelemetry handler for traces, metrics, and logs export via OTLP HTTP.
 * Mirrors Python's OTELHandler from arcade_serve/fastapi/telemetry.py.
 *
 * Gated by ARCADE_MCP_OTEL_ENABLE env var. OTLP endpoint, headers, and
 * protocol are configured via standard OTEL_EXPORTER_OTLP_* env vars.
 */

import {
	type Counter,
	type Meter,
	metrics,
	SpanStatusCode,
	type Tracer,
	trace,
} from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { Resource } from "@opentelemetry/resources";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
	BasicTracerProvider,
	BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import { createLogger } from "./logger.js";

const logger = createLogger("arcade-mcp-telemetry");

export interface OTELHandlerOptions {
	enable: boolean;
	serviceName: string;
	environment: string;
}

export class OTELHandler {
	readonly enabled: boolean;
	private serviceName: string;
	private environment: string;

	private tracerProvider?: BasicTracerProvider;
	private traceExporter?: OTLPTraceExporter;
	private meterProvider?: MeterProvider;
	private metricExporter?: OTLPMetricExporter;

	toolCallCounter?: Counter;

	constructor(options: OTELHandlerOptions) {
		this.enabled = options.enable;
		this.serviceName = options.serviceName;
		this.environment = options.environment;
	}

	initialize(): void {
		if (!this.enabled) return;

		logger.info(
			"Initializing OpenTelemetry. Use environment variables to configure the connection",
		);

		const resource = resourceFromAttributes({
			[ATTR_SERVICE_NAME]: this.serviceName,
			"deployment.environment.name": this.environment,
		});

		this.initTracer(resource);
		this.initMetrics(resource);
	}

	private initTracer(resource: Resource): void {
		this.traceExporter = new OTLPTraceExporter();
		this.tracerProvider = new BasicTracerProvider({
			resource,
			spanProcessors: [new BatchSpanProcessor(this.traceExporter)],
		});
		trace.setGlobalTracerProvider(this.tracerProvider);

		// Test connectivity with a ping span (warn on failure, don't crash)
		try {
			const tracer = trace.getTracer("arcade-mcp-telemetry");
			const span = tracer.startSpan("ping");
			span.end();
		} catch (err) {
			logger.warn(
				{ err },
				"Could not send test span to OpenTelemetry endpoint. Check OTEL configuration or disable.",
			);
		}
	}

	private initMetrics(resource: Resource): void {
		this.metricExporter = new OTLPMetricExporter();
		const metricReader = new PeriodicExportingMetricReader({
			exporter: this.metricExporter,
		});
		this.meterProvider = new MeterProvider({
			resource,
			readers: [metricReader],
		});
		metrics.setGlobalMeterProvider(this.meterProvider);

		const meter = metrics.getMeter("arcade-mcp-server");
		this.toolCallCounter = meter.createCounter("tool_call", {
			description: "Total number of tools called",
			unit: "requests",
		});
	}

	getTracer(name: string): Tracer {
		return trace.getTracer(name);
	}

	getMeter(name: string): Meter {
		return metrics.getMeter(name);
	}

	async shutdown(): Promise<void> {
		if (!this.enabled) return;

		try {
			await this.tracerProvider?.forceFlush();
			await this.tracerProvider?.shutdown();
		} catch (err) {
			logger.warn({ err }, "Error shutting down tracer provider");
		}

		try {
			await this.meterProvider?.forceFlush();
			await this.meterProvider?.shutdown();
		} catch (err) {
			logger.warn({ err }, "Error shutting down meter provider");
		}

		logger.info("OpenTelemetry shut down");
	}
}

export { SpanStatusCode };

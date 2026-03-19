import { z } from "zod";
import {
  FatalToolError,
  MCPApp,
  RetryableToolError,
  UpstreamError,
} from "../../src/index.js";

const app = new MCPApp({
  name: "WeatherAPI",
  version: "1.0.0",
  instructions: "Weather tools demonstrating secrets and error handling",
});

// Get current weather — uses API key secret, demonstrates UpstreamError
app.tool(
  "get_current_weather",
  {
    description: "Get the current weather for a city",
    parameters: z.object({
      city: z.string().describe("City name (e.g. 'London' or 'New York')"),
    }),
    secrets: ["OPENWEATHERMAP_API_KEY"],
  },
  async (args, context) => {
    const apiKey = context.getSecret("OPENWEATHERMAP_API_KEY");

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(args.city)}&appid=${encodeURIComponent(apiKey)}&units=metric`;
    const response = await fetch(url);

    if (response.status === 401) {
      throw new FatalToolError(
        "Invalid API key — check OPENWEATHERMAP_API_KEY",
      );
    }
    if (response.status === 429) {
      throw new RetryableToolError("Rate limited by OpenWeatherMap API", {
        retryAfterMs: 60_000,
      });
    }
    if (!response.ok) {
      throw new UpstreamError(
        `OpenWeatherMap API error: ${response.statusText}`,
        { statusCode: response.status },
      );
    }

    const data = await response.json();
    return {
      city: data.name,
      country: data.sys.country,
      temperature: data.main.temp,
      feels_like: data.main.feels_like,
      humidity: data.main.humidity,
      description: data.weather[0].description,
      wind_speed: data.wind.speed,
    };
  },
);

// Get forecast — demonstrates constrained numeric params and error handling
app.tool(
  "get_forecast",
  {
    description: "Get a multi-day weather forecast for a city",
    parameters: z.object({
      city: z.string().describe("City name"),
      days: z.coerce
        .number()
        .int()
        .min(1)
        .max(5)
        .describe("Number of days to forecast (1-5)"),
    }),
    secrets: ["OPENWEATHERMAP_API_KEY"],
  },
  async (args, context) => {
    const apiKey = context.getSecret("OPENWEATHERMAP_API_KEY");

    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(args.city)}&appid=${encodeURIComponent(apiKey)}&units=metric&cnt=${args.days * 8}`;
    const response = await fetch(url);

    if (response.status === 401) {
      throw new FatalToolError(
        "Invalid API key — check OPENWEATHERMAP_API_KEY",
      );
    }
    if (response.status === 429 || response.status === 503) {
      throw new RetryableToolError("Weather service temporarily unavailable", {
        retryAfterMs: 30_000,
      });
    }
    if (!response.ok) {
      throw new UpstreamError(
        `OpenWeatherMap API error: ${response.statusText}`,
        { statusCode: response.status },
      );
    }

    const data = await response.json();
    const dailyForecasts = data.list
      .filter((_: unknown, i: number) => i % 8 === 0)
      .slice(0, args.days)
      .map((entry: Record<string, unknown>) => ({
        date: (entry as { dt_txt: string }).dt_txt,
        temperature: (entry as { main: { temp: number } }).main.temp,
        description: (entry as { weather: Array<{ description: string }> })
          .weather[0].description,
      }));

    return { city: data.city.name, forecasts: dailyForecasts };
  },
);

app.run();

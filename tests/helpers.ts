import type { AppEnv } from "../src/types";

export function memoryEnv(overrides: AppEnv = {}): AppEnv {
  return {
    APP_ENV: "test",
    APP_BASE_URL: "https://optimizer.test",
    ...overrides,
  };
}

export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

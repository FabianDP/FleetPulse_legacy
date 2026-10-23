import { config } from "dotenv";
import { resolve } from "node:path";

export const rootEnvironmentPath = resolve(__dirname, "../../../.env");

export function loadEnvironment(path = rootEnvironmentPath): void {
  const result = config({ path, quiet: true, override: false });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw new Error("Cannot load root environment configuration");
  }
}

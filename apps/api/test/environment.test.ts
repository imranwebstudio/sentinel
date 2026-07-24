import assert from "node:assert/strict";
import test from "node:test";
import { validateEnvironment } from "../src/config/environment.js";

test("environment validation supplies safe local defaults", () => {
  const environment = validateEnvironment({});
  assert.equal(environment.API_PORT, 3001);
  assert.equal(environment.API_HOST, "127.0.0.1");
});

test("environment validation rejects invalid concurrency-adjacent ports", () => {
  assert.throws(() => validateEnvironment({ API_PORT: "99999" }));
});

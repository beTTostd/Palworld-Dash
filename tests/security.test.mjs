import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/status/route.ts", import.meta.url),
  "utf8",
);

test("status API exposes GET only", () => {
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
});

test("player response uses an explicit safe projection", () => {
  assert.match(route, /name: player\.name/);
  assert.match(route, /level: Math\.max/);
  assert.match(route, /ping: Math\.max/);
  assert.doesNotMatch(route, /\.\.\.player/);
});

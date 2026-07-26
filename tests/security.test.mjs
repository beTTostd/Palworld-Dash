import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/status/route.ts", import.meta.url),
  "utf8",
);
const historyRoute = await readFile(
  new URL("../app/api/history/route.ts", import.meta.url),
  "utf8",
);
const collector = await readFile(
  new URL("../collector/collect.py", import.meta.url),
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

test("history API is read-only at HTTP and SQLite layers", () => {
  assert.match(historyRoute, /export async function GET/);
  assert.doesNotMatch(
    historyRoute,
    /export async function (POST|PUT|PATCH|DELETE)/,
  );
  assert.match(historyRoute, /"-readonly"/);
  assert.doesNotMatch(historyRoute, /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i);
});

test("collector hashes identifiers and stores a safe player projection", () => {
  assert.match(collector, /hashlib\.sha256/);
  assert.doesNotMatch(collector, /player\.get\("iP"\)/);
  assert.doesNotMatch(collector, /player\.get\("location_[xy]"\)/);
  assert.match(collector, /player\.get\("level"\)/);
  assert.match(collector, /player\.get\("ping"\)/);
});

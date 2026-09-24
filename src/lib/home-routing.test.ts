import assert from "node:assert/strict";
import test from "node:test";
import { homePathForRoles } from "./home-routing.ts";

test("admins land on the decision dashboard and members land on the schedule", () => {
  assert.equal(homePathForRoles(["admin"]), "/admin/dashboard");
  assert.equal(homePathForRoles(["writer"]), "/schedule");
  assert.equal(homePathForRoles(["reviewer", "producer"]), "/schedule");
});

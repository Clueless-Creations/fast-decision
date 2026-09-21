// Loaded only by CLI tests using Node --import. Production has no mock switch.
import { response } from "./requests.mjs";
globalThis.fetch = async () => {
  const mode = process.env.FAST_DECISION_TEST_MODE;
  if (mode === "http") return new Response("sensitive-upstream-state", { status: 503 });
  if (mode === "auth") return new Response("sensitive-upstream-state", { status: 401 });
  const value = response();
  if (mode === "bad") value.answers.route.choice = "undeclared";
  return Response.json(value);
};

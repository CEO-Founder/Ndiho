import { createHmac } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import * as registerPatient from "@/app/api/auth/register/patient/route";
import * as ice from "@/app/api/ice/route";
import * as health from "@/app/api/health/route";
import { getPool } from "@/lib/db";
import { getIceConfig, turnCredentials } from "@/lib/ice";
import { call, patientPayload } from "./helpers";

const ENV_KEYS = [
  "NDIHO_TURN_URLS",
  "NDIHO_TURN_SECRET",
  "NDIHO_TURN_TTL_SECONDS",
  "NDIHO_STUN_URLS",
  "NDIHO_ICE_TRANSPORT_POLICY",
  "NDIHO_ICE_SERVERS",
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

afterAll(async () => {
  await getPool().end();
});

describe("TURN credentials", () => {
  it("follows coturn's use-auth-secret scheme", () => {
    const now = Date.UTC(2026, 0, 1);
    const { username, credential } = turnCredentials("user-1", "s3cret", 3600, now);
    expect(username).toBe(`${now / 1000 + 3600}:user-1`);
    expect(credential).toBe(createHmac("sha1", "s3cret").update(username).digest("base64"));
  });

  it("builds STUN + TURN servers from the environment", () => {
    process.env.NDIHO_STUN_URLS = "stun:turn.example.com:3478";
    process.env.NDIHO_TURN_URLS = "turn:turn.example.com:3478?transport=udp, turns:turn.example.com:5349?transport=tcp";
    process.env.NDIHO_TURN_SECRET = "s3cret";
    const config = getIceConfig("user-1");
    expect(config.iceTransportPolicy).toBe("all");
    expect(config.iceServers[0]).toEqual({ urls: ["stun:turn.example.com:3478"] });
    expect(config.iceServers[1]).toMatchObject({
      urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349?transport=tcp"],
      username: expect.stringMatching(/^\d+:user-1$/),
    });
    const expiry = Number(config.iceServers[1].username!.split(":")[0]);
    expect(expiry - Date.now() / 1000).toBeGreaterThan(11 * 3600);
  });

  it("omits TURN without a secret and supports forcing relay", () => {
    process.env.NDIHO_TURN_URLS = "turn:turn.example.com:3478";
    delete process.env.NDIHO_TURN_SECRET;
    process.env.NDIHO_ICE_TRANSPORT_POLICY = "relay";
    const config = getIceConfig("u");
    expect(config.iceServers.some((s) => JSON.stringify(s.urls).includes("turn:"))).toBe(false);
    expect(config.iceTransportPolicy).toBe("relay");
  });
});

describe("ICE and health endpoints", () => {
  it("serves ICE config only to signed-in users, with per-user credentials", async () => {
    process.env.NDIHO_TURN_URLS = "turn:turn.example.com:3478";
    process.env.NDIHO_TURN_SECRET = "s3cret";
    expect((await call(ice.GET, "GET", "/api/ice")).status).toBe(401);
    const reg = await call(registerPatient.POST, "POST", "/r", { body: patientPayload() });
    const res = await call(ice.GET, "GET", "/api/ice", { cookie: reg.cookie });
    expect(res.status).toBe(200);
    expect(res.res.headers.get("cache-control")).toBe("no-store");
    const turn = res.json.iceServers.find((s: { username?: string }) => s.username);
    expect(turn.username.endsWith(`:${reg.json.user.id}`)).toBe(true);
  });

  it("reports database health", async () => {
    const res = await health.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "up" });
  });
});

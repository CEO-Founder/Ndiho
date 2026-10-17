import "server-only";
import { createHmac } from "node:crypto";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceConfig {
  iceServers: IceServer[];
  iceTransportPolicy: "all" | "relay";
}

const DEFAULT_STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Short-lived TURN credentials for coturn's `use-auth-secret` mode (the "TURN
 * REST API"): username = "<expiry unix time>:<user id>", password =
 * base64(HMAC-SHA1(secret, username)). coturn verifies them with the shared
 * secret, so nothing long-lived is ever sent to browsers.
 */
export function turnCredentials(userId: string, secret: string, ttlSeconds: number, now = Date.now()) {
  const username = `${Math.floor(now / 1000) + ttlSeconds}:${userId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential };
}

/**
 * ICE configuration for one user's call. Configure with:
 *   NDIHO_TURN_URLS     comma-separated turn:/turns: URLs of your coturn server
 *   NDIHO_TURN_SECRET   coturn's static-auth-secret
 *   NDIHO_TURN_TTL_SECONDS  credential lifetime (default 12h; must outlast a call)
 *   NDIHO_STUN_URLS     comma-separated stun: URLs (default: Google STUN)
 *   NDIHO_ICE_TRANSPORT_POLICY  "relay" forces all media through TURN (testing)
 *   NDIHO_ICE_SERVERS   JSON RTCIceServer[]; a static override of everything above
 */
export function getIceConfig(userId: string): IceConfig {
  const iceTransportPolicy = process.env.NDIHO_ICE_TRANSPORT_POLICY === "relay" ? "relay" : "all";

  const raw = process.env.NDIHO_ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((s) => s && (typeof s.urls === "string" || Array.isArray(s.urls)))) {
        return { iceServers: parsed, iceTransportPolicy };
      }
    } catch {
      // fall through
    }
    console.error("[ndiho] NDIHO_ICE_SERVERS is not a valid JSON array of RTCIceServer; ignoring it");
  }

  const iceServers: IceServer[] = [];
  const stun = process.env.NDIHO_STUN_URLS !== undefined ? list(process.env.NDIHO_STUN_URLS) : DEFAULT_STUN;
  if (stun.length) iceServers.push({ urls: stun });

  const turnUrls = list(process.env.NDIHO_TURN_URLS);
  const secret = process.env.NDIHO_TURN_SECRET;
  if (turnUrls.length && secret) {
    const ttl = Number(process.env.NDIHO_TURN_TTL_SECONDS) || 12 * 60 * 60;
    iceServers.push({ urls: turnUrls, ...turnCredentials(userId, secret, ttl) });
  } else if (turnUrls.length) {
    console.error("[ndiho] NDIHO_TURN_URLS is set but NDIHO_TURN_SECRET is missing; TURN disabled");
  }
  return { iceServers, iceTransportPolicy };
}

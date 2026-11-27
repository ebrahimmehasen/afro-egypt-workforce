import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { DEFAULT_APPLY_ONLY_HOSTS, isAllowedOnApplyHost, isApplyOnlyHost } from "@/lib/apply-host-gate";
import { clientIp } from "@/lib/recruitment/rate-limit";

const GATED = DEFAULT_APPLY_ONLY_HOSTS[0];

const headers = (extra: Record<string, string> = {}) => ({ get: (k: string) => extra[k.toLowerCase()] ?? null });

describe("isApplyOnlyHost", () => {
  afterEach(() => {
    delete process.env.APPLY_ONLY_HOSTS;
  });

  it("matches the default host, case-insensitively, with or without a port or trailing dot", () => {
    for (const host of [GATED, GATED.toUpperCase(), `${GATED}:443`, `${GATED}.`]) expect(isApplyOnlyHost(host), host).toBe(true);
  });

  it("rejects a lookalike host (suffix match is not allowed)", () => {
    expect(isApplyOnlyHost(`${GATED}.evil.com`)).toBe(false);
    expect(isApplyOnlyHost(`evil-${GATED}`)).toBe(false);
  });

  it("rejects an unrelated host, null, and empty", () => {
    expect(isApplyOnlyHost("localhost")).toBe(false);
    expect(isApplyOnlyHost("192.168.1.10")).toBe(false);
    expect(isApplyOnlyHost(null)).toBe(false);
    expect(isApplyOnlyHost(undefined)).toBe(false);
    expect(isApplyOnlyHost("")).toBe(false);
  });

  it("APPLY_ONLY_HOSTS overrides the default list", () => {
    process.env.APPLY_ONLY_HOSTS = "custom.example.com, other.example.com";
    expect(isApplyOnlyHost("custom.example.com")).toBe(true);
    expect(isApplyOnlyHost("other.example.com")).toBe(true);
    expect(isApplyOnlyHost(GATED)).toBe(false);
  });

  it("an empty or blank APPLY_ONLY_HOSTS falls back to the default", () => {
    process.env.APPLY_ONLY_HOSTS = "";
    expect(isApplyOnlyHost(GATED)).toBe(true);
    process.env.APPLY_ONLY_HOSTS = "   ";
    expect(isApplyOnlyHost(GATED)).toBe(true);
  });
});

describe("isAllowedOnApplyHost", () => {
  const allowed: [string, string][] = [
    ["GET", "/apply"],
    ["GET", "/apply/"],
    ["HEAD", "/apply"],
    ["POST", "/api/apply"],
    ["OPTIONS", "/api/apply"],
    ["GET", "/_next/static/chunks/main.js"],
    ["GET", "/_next/image"],
    ["GET", "/brand/afro-egypt-logo.jpg"],
    ["GET", "/favicon.ico"],
  ];
  const blocked: [string, string][] = [
    ["GET", "/login"],
    ["GET", "/dashboard"],
    ["GET", "/api/punch"],
    ["GET", "/api/applications/x"],
    ["GET", "/api/assistant"],
    ["GET", "/api/employees/x/documents"],
    ["GET", "/payslip/x"],
    ["GET", "/leave-paper/x"],
    ["GET", "/_next/data/x"],
    ["GET", "/"],
    ["DELETE", "/apply"],
    ["POST", "/apply"],
    ["PUT", "/api/apply"],
    ["PATCH", "/api/apply"],
    ["GET", "/api/apply"],
  ];

  it("allows exactly the allowed set", () => {
    for (const [method, path] of allowed) expect(isAllowedOnApplyHost(method, path, headers()), `${method} ${path}`).toBe(true);
  });

  it("blocks the table of disallowed requests", () => {
    for (const [method, path] of blocked) expect(isAllowedOnApplyHost(method, path, headers()), `${method} ${path}`).toBe(false);
  });

  it("blocks any request carrying a Next-Action header, even on an otherwise-allowed path", () => {
    expect(isAllowedOnApplyHost("POST", "/api/apply", headers({ "next-action": "abc123" }))).toBe(false);
    expect(isAllowedOnApplyHost("POST", "/apply", headers({ "next-action": "abc123" }))).toBe(false);
  });
});

describe("the gate inside middleware, on the gated host", () => {
  const visit = (pathname: string, init?: { method?: string; headers?: Record<string, string> }) =>
    middleware(new NextRequest(new URL(`http://x${pathname}`), { headers: { host: GATED, ...(init?.headers ?? {}) }, method: init?.method }));

  it("serves the apply page and its static assets with 200/next, not a redirect", () => {
    for (const path of ["/apply", "/apply/", "/_next/static/chunks/x.js", "/_next/image", "/brand/logo.jpg", "/favicon.ico"]) {
      const res = visit(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("404s everything else, with no redirect to /login and no body hint", async () => {
    for (const path of ["/login", "/dashboard", "/api/punch", "/api/applications/x", "/api/assistant", "/api/employees/x/documents", "/payslip/x", "/_next/data/x", "/"]) {
      const res = visit(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("location"), path).toBeNull();
      expect(await res.text(), path).toBe("");
    }
  });

  it("404s a DELETE on /apply and a Next-Action POST to an arbitrary path", () => {
    expect(visit("/apply", { method: "DELETE" }).status).toBe(404);
    expect(visit("/dashboard", { method: "POST", headers: { "next-action": "x" } }).status).toBe(404);
    expect(visit("/apply", { method: "POST", headers: { "next-action": "x" } }).status).toBe(404);
  });

  it("404s a host with a port, uppercase, a trailing dot the same way — all still gated", () => {
    const req = (host: string) => middleware(new NextRequest(new URL("http://x/dashboard"), { headers: { host } }));
    for (const host of [`${GATED}:8080`, GATED.toUpperCase(), `${GATED}.`]) expect(req(host).status, host).toBe(404);
  });

  it("is NOT fooled by a lookalike host or a spoofed x-forwarded-host", () => {
    const lookalike = middleware(new NextRequest(new URL("http://x/dashboard"), { headers: { host: `${GATED}.evil.com` } }));
    expect(lookalike.status).not.toBe(404);
    const spoofed = middleware(new NextRequest(new URL("http://x/dashboard"), { headers: { host: "localhost", "x-forwarded-host": GATED } }));
    // real host is localhost, so this follows ordinary non-gated behaviour (redirect to /login), never the gate's 404
    expect(spoofed.status).toBe(307);
  });

  it("sets the security headers on an allowed response, and no-store on /api/apply", () => {
    const res = visit("/apply");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    const apiRes = middleware(new NextRequest(new URL("http://x/api/apply"), { headers: { host: GATED }, method: "POST" }));
    expect(apiRes.headers.get("cache-control")).toBe("no-store");
  });
});

describe("clientIp on the gated host trusts only Cloudflare's own header", () => {
  it("uses cf-connecting-ip when present, trustOnlyCloudflare or not", () => {
    expect(clientIp(headers({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }), { trustOnlyCloudflare: true })).toBe("1.2.3.4");
  });

  it("without trustOnlyCloudflare, falls back to x-forwarded-for (ordinary, non-gated behaviour)", () => {
    expect(clientIp(headers({ "x-forwarded-for": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("with trustOnlyCloudflare, a spoofed x-forwarded-for is ignored — falls back to the shared \"unknown\" bucket", () => {
    expect(clientIp(headers({ "x-forwarded-for": "9.9.9.9" }), { trustOnlyCloudflare: true })).toBe("unknown");
  });
});

describe("every other host is unaffected", () => {
  const visit = (pathname: string, host = "localhost") => middleware(new NextRequest(new URL(`http://x${pathname}`), { headers: { host } }));

  it("still redirects an anonymous visitor to /login for a protected page", () => {
    const res = visit("/dashboard");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("still redirects /login the same way on localhost and a LAN IP", () => {
    for (const host of ["localhost", "192.168.1.50", "znu.404legend.space"]) {
      const res = visit("/dashboard", host);
      expect(res.status, host).toBe(307);
    }
  });

  it("lets /api, /_next/static and /brand pass through untouched (as the old matcher did)", () => {
    for (const path of ["/api/punch", "/_next/static/chunks/x.js", "/brand/logo.jpg", "/favicon.ico"]) {
      const res = visit(path);
      expect(res.status, path).toBe(200);
    }
  });
});

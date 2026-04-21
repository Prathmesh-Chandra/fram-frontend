const BASE = "http://127.0.0.1:8000";

const UPSTOX_LOGIN_PATH = "/data/upstox/login";
const UPSTOX_STATUS_PATH = "/data/upstox/status";

class AuthRedirectError extends Error {
  constructor(message = "UPSTOX_AUTH_REQUIRED") {
    super(message);
    this.name = "AuthRedirectError";
  }
}

const redirectToUpstoxLogin = (loginPath = UPSTOX_LOGIN_PATH) => {
  window.location.assign(`${BASE}${loginPath}`);
};

const isAuthFailurePayload = (payload) => {
  const detail = payload?.detail;
  if (!detail) return false;
  if (typeof detail === "string") return detail === "UPSTOX_TOKEN_EXPIRED";
  return detail?.code === "UPSTOX_AUTH_REQUIRED";
};

const handle = async (res, options = {}) => {
  const { redirectOnAuthFailure = true } = options;

  if (res.status === 401) {
    const payload = await res.json().catch(() => ({}));
    const loginPath = payload?.detail?.login_url || UPSTOX_LOGIN_PATH;
    if (redirectOnAuthFailure) {
      redirectToUpstoxLogin(loginPath);
      throw new AuthRedirectError();
    }
    return payload;
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    if (isAuthFailurePayload(payload)) {
      const loginPath = payload?.detail?.login_url || UPSTOX_LOGIN_PATH;
      if (redirectOnAuthFailure) {
        redirectToUpstoxLogin(loginPath);
        throw new AuthRedirectError();
      }
      return payload;
    }

    const detailMessage = typeof payload?.detail === "string"
      ? payload.detail
      : payload?.detail?.message;
    throw new Error(detailMessage || `API error ${res.status}`);
  }

  return res.json();
};

const apiGet = (path, options = {}) => {
  const { timeoutMs = 20000 } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(`${BASE}${path}`, { signal: controller.signal })
    .then((res) => handle(res, options))
    .finally(() => clearTimeout(timeoutId));
};

export const fetchUpstoxStatus = (options = {}) => apiGet(UPSTOX_STATUS_PATH, options);

export const ensureUpstoxLoginOnStartup = async () => {
  try {
    const status = await fetchUpstoxStatus({ redirectOnAuthFailure: false });
    if (!status?.authenticated) {
      redirectToUpstoxLogin(status?.login_url || UPSTOX_LOGIN_PATH);
      return null;
    }
    return status;
  } catch {
    redirectToUpstoxLogin(UPSTOX_LOGIN_PATH);
    return null;
  }
};

export const fetchUniverse = () => apiGet("/data/universe");

export const fetchHistory = (ticker) =>
  apiGet(`/data/history?ticker=${encodeURIComponent(ticker)}&period=6mo`);

export { BASE, redirectToUpstoxLogin };

export const fetchPartA = async (liquidTicker, illiquidTicker) => {
  const res = await fetch(`${BASE}/analytics/part-a`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      liquid_ticker: liquidTicker,
      illiquid_ticker: illiquidTicker,
      period: "122d"
    })
  })
  return handle(res)
}

const avgByKey = (rows = [], key) => {
  const vals = rows
    .map((r) => r?.[key])
    .filter((v) => typeof v === "number" && Number.isFinite(v))
  if (!vals.length) return null
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2))
}

const buildComparisonFromSides = (liquidData = {}, illiquidData = {}) => {
  const lRows = Array.isArray(liquidData?.pricing_table) ? liquidData.pricing_table : []
  const iRows = Array.isArray(illiquidData?.pricing_table) ? illiquidData.pricing_table : []

  const comparison = {
    hist_vol_pct: {
      liquid: liquidData?.hist_vol_pct ?? null,
      illiquid: illiquidData?.hist_vol_pct ?? null,
    },
    avg_price_deviation_pct: {
      liquid: avgByKey(lRows, "price_deviation_pct"),
      illiquid: avgByKey(iRows, "price_deviation_pct"),
    },
    avg_iv_spread_pct: {
      liquid: avgByKey(lRows, "iv_spread_pct"),
      illiquid: avgByKey(iRows, "iv_spread_pct"),
    },
  }

  const lGarchVol = liquidData?.garch?.vol_comparison?.garch_vol_pct
  const iGarchVol = illiquidData?.garch?.vol_comparison?.garch_vol_pct
  if (typeof lGarchVol === "number" && typeof iGarchVol === "number") {
    comparison.garch_vol_pct = { liquid: lGarchVol, illiquid: iGarchVol }
  }

  return comparison
}

const fetchPartBSingle = async (ticker, include_garch = true, period = "6mo") => {
  const res = await fetch(`${BASE}/pricing/part-b`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticker,
      target_maturities: [30, 60],
      include_garch,
      period,
    }),
  })
  return handle(res)
}

export const fetchPartB = async (liquidTicker, illiquidTicker) => {
  const query = new URLSearchParams({
    liquid_ticker: liquidTicker,
    illiquid_ticker: illiquidTicker,
    include_garch: "true",
    period: "6mo"
  })

  const res = await fetch(`${BASE}/pricing/part-b/compare?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  })

  try {
    return await handle(res)
  } catch (compareErr) {
    const [liquidRes, illiquidRes] = await Promise.allSettled([
      fetchPartBSingle(liquidTicker, true, "6mo"),
      fetchPartBSingle(illiquidTicker, true, "6mo"),
    ])

    const liquidData = liquidRes.status === "fulfilled"
      ? liquidRes.value?.data
      : {
          ticker: liquidTicker,
          spot: null,
          hist_vol_pct: null,
          pricing_table: [],
          garch: null,
          expiry_map: {},
          error: liquidRes.reason?.message || "Failed to load Part B for liquid stock",
        }

    const illiquidData = illiquidRes.status === "fulfilled"
      ? illiquidRes.value?.data
      : {
          ticker: illiquidTicker,
          spot: null,
          hist_vol_pct: null,
          pricing_table: [],
          garch: null,
          expiry_map: {},
          error: illiquidRes.reason?.message || "Failed to load Part B for illiquid stock",
        }

    const hasAnySuccess = liquidRes.status === "fulfilled" || illiquidRes.status === "fulfilled"
    if (!hasAnySuccess) {
      throw compareErr
    }

    return {
      status: (liquidRes.status === "fulfilled" && illiquidRes.status === "fulfilled")
        ? "success"
        : "partial_success",
      data: {
        liquid: liquidData,
        illiquid: illiquidData,
        comparison: buildComparisonFromSides(liquidData, illiquidData),
        errors: {
          liquid: liquidRes.status === "rejected" ? (liquidRes.reason?.message || "Failed") : null,
          illiquid: illiquidRes.status === "rejected" ? (illiquidRes.reason?.message || "Failed") : null,
        },
      },
    }
  }
}

export const fetchPartC = async (payload) => {
  const res = await fetch(`${BASE}/portfolio/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
  return handle(res)
}

export const fetchPartD = async (liquidTicker, illiquidTicker, period = "6mo") => {
  const res = await fetch(`${BASE}/risk/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      liquid_ticker: liquidTicker,
      illiquid_ticker: illiquidTicker,
      period,
    }),
  })
  return handle(res)
}
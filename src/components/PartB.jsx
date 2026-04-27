import { useState, useMemo, useEffect, useRef } from "react"
import {
  ComposedChart, Line, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts"
import usePortfolioStore from "@/store/usePortfolioStore"

// ─── Design tokens (mirrors PartA exactly) ────────────────────────────────────
const T = {
  a: "#60a5fa", b: "#fb923c",
  aDim: "#60a5fa18", bDim: "#fb923c18",
  aBorder: "#60a5fa30", bBorder: "#fb923c30",
  aBg: "#0d1520", bBg: "#1a1005",
  accent: "#a78bfa", accentDim: "#a78bfa15",
  divider: "#ffffff0f", grid: "#ffffff08",
  axis: "#ffffff28", muted: "#ffffff40",
  surface: "#111116", surfaceHi: "#16161c",
  ttBg: "#0a0a0e", ttBorder: "#2a2a35",
}
const C30 = "#60a5fa"    // blue  — 30d maturity
const C60 = "#f472b6"   // pink  — 60d maturity

// ─── BSM implementation (JS) ──────────────────────────────────────────────────
const normCDF = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp(-x * x / 2)
  const p = t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302744))))
  const v = 1 - d * p
  return x >= 0 ? v : 1 - v
}
const bsm = (S, K, T_y, r, sig, type) => {
  if (T_y <= 0 || sig <= 0 || S <= 0 || K <= 0) return 0
  const d1 = (Math.log(S / K) + (r + 0.5 * sig * sig) * T_y) / (sig * Math.sqrt(T_y))
  const d2 = d1 - sig * Math.sqrt(T_y)
  return type === "call"
    ? S * normCDF(d1) - K * Math.exp(-r * T_y) * normCDF(d2)
    : K * Math.exp(-r * T_y) * normCDF(-d2) - S * normCDF(-d1)
}

// Generate smooth BSM price curve across a strike range
const genBSMCurve = (spot, sigma, r, T_y, n = 70) =>
  Array.from({ length: n }, (_, i) => {
    const kS = 0.70 + (0.60 * i) / (n - 1)   // K/S from 0.70 to 1.30
    const K  = spot * kS
    return { kS: +kS.toFixed(4), call: +bsm(spot, K, T_y, r, sigma, "call").toFixed(4), put: +bsm(spot, K, T_y, r, sigma, "put").toFixed(4) }
  })

// Fit quadratic IV smile through 3 anchor points; return 50-pt smooth curve
const genSmileLine = (pricingTable, spot, maturity, n = 50) => {
  if (!spot || !Number.isFinite(spot) || spot <= 0) return []
  const rows  = (pricingTable || []).filter(r => r.target_maturity_days === maturity && r.market_iv_pct > 0)
  const atm   = rows.find(r => r.moneyness === "ATM" && r.option_type === "CALL")
  const otmC  = rows.find(r => r.moneyness === "OTM Call")
  const otmP  = rows.find(r => r.moneyness === "OTM Put")
  if (!atm) return []
  const a  = (atm.market_iv_pct || 20) / 100
  const kC = otmC ? Math.log(otmC.strike / spot) : 0.075
  const ivC = otmC ? otmC.market_iv_pct / 100 : a * 1.1
  const kP  = otmP ? Math.log(otmP.strike / spot) : -0.075
  const ivP  = otmP ? otmP.market_iv_pct / 100 : a * 1.15
  // Solve 3-point quadratic: iv = a + b*k + c*k²
  const det = kC * kP * (kP - kC)
  if (Math.abs(det) < 1e-10) return Array.from({ length: n }, (_, i) => ({ kS: +(0.80 + i * 0.40 / (n-1)).toFixed(4), iv: +(a * 100).toFixed(4) }))
  const c = ((ivP - a) * kC - (ivC - a) * kP) / det
  const b = (ivC - a - c * kC * kC) / (kC || 1e-8)
  return Array.from({ length: n }, (_, i) => {
    const kS = 0.82 + (0.36 * i) / (n - 1)
    const k  = Math.log(kS)
    const iv = Math.max(a + b * k + c * k * k, 0.005) * 100
    return { kS: +kS.toFixed(4), iv: +iv.toFixed(4) }
  })
}

// Generate IV surface grid  (kS × T → IV%)
const genIVSurface = (atmVolPct, pricingTable, spot) => {
  const atmVol = (atmVolPct || 20) / 100
  const rows   = (pricingTable || []).filter(r => r.market_iv_pct > 0 && r.strike > 0)
  const otmC   = rows.find(r => r.moneyness === "OTM Call" && r.target_maturity_days === 30)
  const otmP   = rows.find(r => r.moneyness === "OTM Put"  && r.target_maturity_days === 30)
  const kC = otmC ? Math.log(otmC.strike / spot) : 0.075
  const ivC = otmC ? otmC.market_iv_pct / 100 : atmVol * 1.12
  const kP  = otmP ? Math.log(otmP.strike / spot) : -0.075
  const ivP  = otmP ? otmP.market_iv_pct / 100 : atmVol * 1.18
  const det = kC * kP * (kP - kC)
  const c   = Math.abs(det) > 1e-10 ? ((ivP - atmVol) * kC - (ivC - atmVol) * kP) / det : 3.0
  const b   = Math.abs(kC) > 1e-8  ? (ivC - atmVol - c * kC * kC) / kC : -0.12
  const kSArr = Array.from({ length: 22 }, (_, i) => +(0.76 + i * (0.48 / 21)).toFixed(3))
  const tArr  = Array.from({ length: 12 }, (_, i) => 15 + i * 7)
  const z     = tArr.map(td => {
    const termFactor = 1 + 0.05 * (30 - td) / 30
    return kSArr.map(kS => {
      const k  = Math.log(kS)
      const iv = Math.max((atmVol + b * k + c * k * k) * termFactor, 0.005) * 100
      return +iv.toFixed(3)
    })
  })
  return { x: kSArr, y: tArr, z }
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt2  = (v) => v != null && !isNaN(v) ? Number(v).toFixed(2) : "—"
const fmt4  = (v) => v != null && !isNaN(v) ? Number(v).toFixed(4) : "—"
const fmtPct = (v) => v != null && !isNaN(v) ? `${Number(v).toFixed(2)}%` : "—"

const tooltipProps = {
  contentStyle: {
    backgroundColor: T.ttBg, border: `1px solid ${T.ttBorder}`,
    borderRadius: 6, fontSize: 11, padding: "8px 12px",
    boxShadow: "0 8px 32px #00000080",
  },
  labelStyle: { color: T.muted, marginBottom: 4, fontSize: 10 },
}
const axisProps = {
  stroke: T.axis, fontSize: 10, tickMargin: 5,
  tick: { fill: T.muted, fontFamily: "'DM Mono', monospace" },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label, sub }) {
  return (
    <div className="flex items-center gap-4 mb-4">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] shrink-0" style={{ color: T.accent }}>
        {label}
      </span>
      {sub && <span className="text-[10px] tracking-wider" style={{ color: T.muted }}>{sub}</span>}
      <div className="flex-1 h-px" style={{ background: T.divider }} />
    </div>
  )
}

function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-1.5" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
      <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: accent ? `${accent}80` : T.muted }}>
        {label}
      </span>
      <span className="text-[15px] font-mono font-semibold tabular-nums" style={{ color: "#e8e8f0" }}>
        {value ?? "—"}
      </span>
    </div>
  )
}

function ChartCard({ title, badge, height = 240, children }) {
  return (
    <div className="rounded-lg flex flex-col overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ background: T.surfaceHi, borderBottom: `1px solid ${T.divider}` }}>
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "#d0d0e0" }}>
          {title}
        </span>
        {badge && (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded"
            style={{ background: T.accentDim, color: T.accent, border: `1px solid ${T.accent}30` }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ height }} className="px-3 pt-3 pb-2">
        {children}
      </div>
    </div>
  )
}

// Pricing table row — defined outside to avoid React reconciliation issues
function PricingRow({ row, showGarch, colSpan }) {
  const devStr = (v) => {
    if (v == null || isNaN(v)) return "—"
    const n = Number(v)
    return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`
  }
  const devColor = (v) => {
    if (v == null || isNaN(v)) return T.muted
    return Number(v) > 2 ? "#4ade80" : Number(v) < -2 ? "#f87171" : "#c8c8d8"
  }
  const typeColor  = row.option_type === "CALL" ? T.a : T.b
  const typeDim    = row.option_type === "CALL" ? T.aDim : T.bDim
  const typeBorder = row.option_type === "CALL" ? T.aBorder : T.bBorder
  const isATM      = row.moneyness === "ATM"
  const garchDev   = (row.garch_vs_market_diff != null && row.bsm_price_garch_vol)
    ? (row.garch_vs_market_diff / row.bsm_price_garch_vol * 100)
    : null

  return (
    <tr className="border-b transition-colors hover:bg-white/[0.018]"
      style={{ borderColor: T.divider, background: isATM ? "#a78bfa08" : "transparent" }}>
      <td className="py-2.5 px-4 text-[11px] font-medium" style={{ color: "#d0d0e0" }}>{row.moneyness}</td>
      <td className="py-2.5 px-4">
        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
          style={{ color: typeColor, background: typeDim, border: `1px solid ${typeBorder}` }}>
          {row.option_type}
        </span>
      </td>
      <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums" style={{ color: "#d0d0e0" }}>
        ₹{Number(row.strike).toFixed(2)}
      </td>
      <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums" style={{ color: T.muted }}>
        {Number(row.T_years).toFixed(4)}
      </td>
      <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums" style={{ color: T.accent }}>
        {row.hist_vol_pct != null ? `${Number(row.hist_vol_pct).toFixed(2)}%` : "—"}
      </td>
      <td className="py-2.5 px-4 text-[12px] font-mono tabular-nums font-semibold text-right" style={{ color: "#f0f0f8" }}>
        {row.market_price > 0 ? `₹${Number(row.market_price).toFixed(2)}` : <span style={{ color: T.muted }}>—</span>}
      </td>
      <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums text-right" style={{ color: "#b0b8d0" }}>
        ₹{fmt2(row.bsm_price_hist_vol)}
      </td>
      <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums text-right"
        style={{ color: devColor(row.price_deviation_pct) }}>
        {devStr(row.price_deviation_pct)}
      </td>
      {showGarch && <>
        <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums text-right" style={{ color: T.accent }}>
          {row.bsm_price_garch_vol ? `₹${Number(row.bsm_price_garch_vol).toFixed(2)}` : "—"}
        </td>
        <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums text-right"
          style={{ color: devColor(garchDev) }}>
          {devStr(garchDev)}
        </td>
      </>}
      <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums text-right" style={{ color: T.muted }}>
        {fmt4(row.delta)}
      </td>
      <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums text-right" style={{ color: T.muted }}>
        {row.gamma != null ? Number(row.gamma).toFixed(6) : "—"}
      </td>
      <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums text-right" style={{ color: T.muted }}>
        {fmt4(row.vega)}
      </td>
      <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums text-right" style={{ color: T.muted }}>
        {fmt4(row.theta)}
      </td>
    </tr>
  )
}

// ─── Plotly 3D IV Surface ─────────────────────────────────────────────────────
function IVSurfacePlot({ histVol, pricingTable, spot, ticker, themeColor }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current || !histVol || !spot) return
    let cancelled = false

    const { x, y, z } = genIVSurface(histVol, pricingTable, spot)

    const trace = {
      type: "surface",
      x, y, z,
      colorscale: [
        [0,   "#1a2035"],
        [0.3, themeColor + "80"],
        [0.7, themeColor],
        [1,   "#ffffff"],
      ],
      opacity: 0.93,
      lighting: { ambient: 0.8, diffuse: 0.7, specular: 0.2 },
      contours: {
        z: { show: true, usecolormap: true, highlightcolor: "#ffffff60", project: { z: true } },
      },
      hovertemplate:
        "<b>K/S:</b> %{x:.3f}<br><b>Expiry:</b> %{y}d<br><b>IV:</b> %{z:.2f}%<extra>" + ticker + "</extra>",
    }

    const layout = {
      autosize: true,
      margin: { l: 0, r: 0, t: 10, b: 0 },
      paper_bgcolor: T.surface,
      scene: {
        bgcolor: "#0c0c12",
        xaxis: {
          title: { text: "K / S", font: { color: T.muted, size: 10 } },
          tickfont: { color: T.muted, size: 9 },
          gridcolor: "#ffffff10", zerolinecolor: "#ffffff15",
        },
        yaxis: {
          title: { text: "Days to Expiry", font: { color: T.muted, size: 10 } },
          tickfont: { color: T.muted, size: 9 },
          gridcolor: "#ffffff10", zerolinecolor: "#ffffff15",
        },
        zaxis: {
          title: { text: "IV (%)", font: { color: T.muted, size: 10 } },
          tickfont: { color: T.muted, size: 9 },
          gridcolor: "#ffffff10", zerolinecolor: "#ffffff15",
        },
        camera: { eye: { x: 1.6, y: -1.6, z: 1.1 } },
        aspectmode: "manual",
        aspectratio: { x: 1.2, y: 1.2, z: 0.8 },
      },
    }

    const config = {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ["toImage", "sendDataToCloud"],
      displaylogo: false,
    }

    import("plotly.js-dist-min")
      .then(mod => {
        const Plotly = mod.default || mod
        if (!cancelled && ref.current) {
          Plotly.newPlot(ref.current, [trace], layout, config)
        }
      })
      .catch(() => {
        if (!cancelled && ref.current && window.Plotly) {
          window.Plotly.newPlot(ref.current, [trace], layout, config)
        }
      })

    return () => {
      cancelled = true
      const el = ref.current
      if (el && window.Plotly) window.Plotly.purge(el)
    }
  }, [histVol, spot, ticker, themeColor]) // eslint-disable-line

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />
}

// ─── Mini chart legend ────────────────────────────────────────────────────────
function ChartLegend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-1 mb-2">
      {items.map(({ color, label, dash }) => (
        <div key={label} className="flex items-center gap-1.5">
          <svg width="16" height="3">
            <line x1="0" y1="1.5" x2="16" y2="1.5"
              stroke={color} strokeWidth="2"
              strokeDasharray={dash || "none"} />
          </svg>
          <span className="text-[10px] font-mono" style={{ color }}>{label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PartB() {
  const { partBData } = usePortfolioStore()
  const [activeAsset, setActiveAsset]     = useState("liquid")
  const [showGarch, setShowGarch]         = useState(false)
  const [activeSurface, setActiveSurface] = useState("liquid")

  if (!partBData) return null

  const data = partBData?.data || {}
  const liqD = data?.liquid   || {}
  const illD = data?.illiquid || {}
  const comp = data?.comparison || {}

  const lTick = liqD?.ticker || "LIQUID"
  const iTick = illD?.ticker || "ILLIQUID"
  const cur   = activeAsset === "liquid" ? liqD : illD
  const curColor = activeAsset === "liquid" ? T.a : T.b
  const curTick  = cur?.ticker || activeAsset.toUpperCase()

  const rows   = Array.isArray(cur?.pricing_table) ? cur.pricing_table : []
  const rows30 = rows.filter(r => r.target_maturity_days === 30)
  const rows60 = rows.filter(r => r.target_maturity_days === 60)

  const hasLiqRows = Array.isArray(liqD?.pricing_table) && liqD.pricing_table.length > 0
  const hasIllRows = Array.isArray(illD?.pricing_table) && illD.pricing_table.length > 0

  useEffect(() => {
    // Keep the active tab on the side that actually has data.
    if (activeAsset === "liquid" && !hasLiqRows && hasIllRows) setActiveAsset("illiquid")
    if (activeAsset === "illiquid" && !hasIllRows && hasLiqRows) setActiveAsset("liquid")
  }, [activeAsset, hasLiqRows, hasIllRows])

  const garchComp   = cur?.garch?.vol_comparison || {}
  const garchParams = garchComp?.garch_params    || {}
  const liqGarch    = liqD?.garch?.vol_comparison || {}
  const illGarch    = illD?.garch?.vol_comparison || {}

  // Total table column count (for section row colspan)
  const totalCols = showGarch ? 14 : 12

  // ── Chart data ─────────────────────────────────────────────────────────────
  const R = 0.068

  const bsmChartData = useMemo(() => {
    if (!cur?.spot || !cur?.hist_vol_pct) return []
    const sig = cur.hist_vol_pct / 100
    const c30 = genBSMCurve(cur.spot, sig, R, 30 / 252)
    const c60 = genBSMCurve(cur.spot, sig, R, 60 / 252)
    return c30.map((pt, i) => ({
      kS:     pt.kS,
      call30: pt.call,
      put30:  pt.put,
      call60: c60[i]?.call,
      put60:  c60[i]?.put,
    }))
  }, [cur?.spot, cur?.hist_vol_pct])

  // Scatter dots for actual pricing table strikes
  const bsmDots = useMemo(() => {
    if (!cur?.spot) return []
    return rows.map(r => ({
      kS:    +(r.strike / cur.spot).toFixed(4),
      price: r.option_type === "CALL" ? r.bsm_price_hist_vol : r.bsm_price_hist_vol,
      type:  r.option_type,
      mat:   r.target_maturity_days,
    })).filter(d => d.price > 0)
  }, [rows, cur?.spot])

  // IV Smile: smooth fitted lines + actual scatter dots
  const smileLiq30 = useMemo(() => genSmileLine(liqD?.pricing_table, liqD?.spot, 30), [liqD])
  const smileLiq60 = useMemo(() => genSmileLine(liqD?.pricing_table, liqD?.spot, 60), [liqD])
  const smileIll30 = useMemo(() => genSmileLine(illD?.pricing_table, illD?.spot, 30), [illD])
  const smileIll60 = useMemo(() => genSmileLine(illD?.pricing_table, illD?.spot, 60), [illD])

  const ivDotsMake = (table, spot) => {
    if (!spot || !Number.isFinite(spot) || spot <= 0) return []
    return (table || [])
      .filter(r => r.market_iv_pct > 0 && r.strike > 0)
      .map(r => ({ kS: +(r.strike / spot).toFixed(4), iv: r.market_iv_pct }))
  }

  const ivDotsLiq30 = useMemo(() => ivDotsMake(liqD?.pricing_table?.filter(r => r.target_maturity_days === 30), liqD?.spot), [liqD])
  const ivDotsLiq60 = useMemo(() => ivDotsMake(liqD?.pricing_table?.filter(r => r.target_maturity_days === 60), liqD?.spot), [liqD])
  const ivDotsIll30 = useMemo(() => ivDotsMake(illD?.pricing_table?.filter(r => r.target_maturity_days === 30), illD?.spot), [illD])
  const ivDotsIll60 = useMemo(() => ivDotsMake(illD?.pricing_table?.filter(r => r.target_maturity_days === 60), illD?.spot), [illD])

  // ── Helpers ────────────────────────────────────────────────────────────────
  const expiry = (n) => cur?.expiry_map?.[String(n)] || "—"

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 pb-12 px-1 animate-in fade-in duration-500" style={{ color: "#d8d8e8" }}>

      {/* ── 1. CONTROLS ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Asset tabs */}
        <div className="flex rounded-lg overflow-hidden p-0.5 gap-0.5"
          style={{ background: T.surfaceHi, border: `1px solid ${T.divider}` }}>
          {[
            { key: "liquid",   label: lTick, color: T.a, dim: T.aDim },
            { key: "illiquid", label: iTick, color: T.b, dim: T.bDim },
          ].map(({ key, label, color, dim }) => {
            const active = activeAsset === key
            return (
              <button key={key} onClick={() => setActiveAsset(key)}
                className="px-5 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] rounded transition-all duration-150"
                style={{
                  background: active ? dim : "transparent",
                  color:      active ? color : T.muted,
                  border:     active ? `1px solid ${color}30` : "1px solid transparent",
                }}>
                {label}
              </button>
            )
          })}
        </div>

        {/* GARCH toggle */}
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg"
          style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: T.muted }}>
            GARCH(1,1) Overlay
          </span>
          <button onClick={() => setShowGarch(g => !g)}
            className="relative w-10 h-5 rounded-full transition-colors duration-200 shrink-0"
            style={{ background: showGarch ? T.accent : "#ffffff18" }}>
            <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200 shadow"
              style={{ left: showGarch ? "1.375rem" : "0.125rem" }} />
          </button>
        </div>
      </div>

      {/* ── 2. OVERVIEW CARDS ────────────────────────────────────────────── */}
      <section>
        <SectionHeader label="Underlying Overview" sub={curTick} />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Spot Price"        value={cur?.spot ? `₹${Number(cur.spot).toFixed(2)}` : "—"} />
          <StatCard label="Historical Vol"    value={fmtPct(cur?.hist_vol_pct)}  accent={curColor} />
          <StatCard label="30d Expiry"        value={expiry(30)} />
          <StatCard label="60d Expiry"        value={expiry(60)} />
          {showGarch && <>
            <StatCard label="GARCH(1,1) Vol"   value={fmtPct(garchComp?.garch_vol_pct)}  accent={T.accent} />
            <StatCard label="Persistence (α+β)" value={garchParams?.persistence != null ? Number(garchParams.persistence).toFixed(4) : "—"} accent={T.accent} />
            <StatCard label="Long-Run Vol"     value={fmtPct(garchComp?.long_run_vol_pct)} accent={T.accent} />
            <StatCard label="GARCH Higher?"    value={garchComp?.garch_higher != null ? (garchComp.garch_higher ? "Yes — forward fear" : "No — mean-reverting") : "—"} />
          </>}
        </div>
      </section>

      {/* ── 3. GARCH PARAMS TABLE ────────────────────────────────────────── */}
      {showGarch && (
        <section className="animate-in fade-in slide-in-from-top-2 duration-300">
          <SectionHeader label="GARCH(1,1) Model Parameters" sub="Conditional volatility estimation — both stocks" />
          <div className="rounded-lg overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.accent}20` }}>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-160">
                <thead>
                  <tr style={{ background: T.surfaceHi, borderBottom: `1px solid ${T.divider}` }}>
                    {["Stock", "ω (omega)", "α (alpha)", "β (beta)", "α + β (Persistence)", "GARCH σ (ann.)"].map(h => (
                      <th key={h} className="py-3 px-5 text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: T.muted }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { tick: lTick, g: liqGarch, color: T.a },
                    { tick: iTick, g: illGarch, color: T.b },
                  ].map(({ tick, g, color }) => {
                    const p = g?.garch_params || {}
                    return (
                      <tr key={tick} className="border-b" style={{ borderColor: T.divider }}>
                        <td className="py-3 px-5 text-[12px] font-mono font-bold" style={{ color }}>{tick}</td>
                        <td className="py-3 px-5 text-[12px] font-mono tabular-nums" style={{ color: "#d0d0e0" }}>
                          {p.omega != null ? Number(p.omega).toFixed(4) : "—"}
                        </td>
                        <td className="py-3 px-5 text-[12px] font-mono tabular-nums" style={{ color: "#d0d0e0" }}>
                          {p.alpha != null ? Number(p.alpha).toFixed(4) : "—"}
                        </td>
                        <td className="py-3 px-5 text-[12px] font-mono tabular-nums" style={{ color: "#d0d0e0" }}>
                          {p.beta != null ? Number(p.beta).toFixed(4) : "—"}
                        </td>
                        <td className="py-3 px-5 text-[13px] font-mono tabular-nums font-semibold" style={{ color: T.accent }}>
                          {p.persistence != null ? Number(p.persistence).toFixed(4) : "—"}
                        </td>
                        <td className="py-3 px-5 text-[13px] font-mono tabular-nums font-semibold" style={{ color }}>
                          {fmtPct(g?.garch_vol_pct)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {garchComp?.interpretation && (
              <div className="px-5 py-3 text-[11px] leading-relaxed border-t" style={{ color: T.muted, borderColor: T.divider }}>
                {garchComp.interpretation}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 4. PRICING TABLE ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader label="Derivatives Pricing Matrix"
          sub={`${curTick} — BSM (hist. vol)${showGarch ? " + GARCH" : ""} vs Market`} />
        <div className="rounded-lg overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ minWidth: showGarch ? 1100 : 920 }}>
              <thead>
                <tr style={{ background: T.surfaceHi, borderBottom: `1px solid ${T.divider}` }}>
                  {[
                    ["Moneyness",    "text-left"],
                    ["Type",         "text-left"],
                    ["Strike (K)",   "text-left"],
                    ["T (yrs)",      "text-left"],
                    ["σ (hist)",     "text-left"],
                    ["Market (₹)",   "text-right"],
                    ["BSM (₹)",      "text-right"],
                    ["Dev %",        "text-right"],
                    ...(showGarch ? [["GARCH BSM (₹)", "text-right"], ["GARCH Dev %", "text-right"]] : []),
                    ["Delta (Δ)",    "text-right"],
                    ["Gamma (Γ)",    "text-right"],
                    ["Vega (ν)",     "text-right"],
                    ["Theta (θ)",    "text-right"],
                  ].map(([h, align]) => (
                    <th key={h} className={`py-3 px-4 text-[9px] font-bold uppercase tracking-[0.15em] ${align}`}
                      style={{ color: T.muted }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>

                {/* 30-day section */}
                {rows30.length > 0 && <>
                  <tr style={{ background: "#101018" }}>
                    <td colSpan={totalCols} className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C30 }}>
                          30-Day Target
                        </span>
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded"
                          style={{ background: `${C30}18`, color: C30, border: `1px solid ${C30}30` }}>
                          Expiry {expiry(30)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {rows30.map((row, i) => <PricingRow key={`30-${i}`} row={row} showGarch={showGarch} />)}
                </>}

                {/* 60-day section */}
                {rows60.length > 0 && <>
                  <tr style={{ background: "#101018" }}>
                    <td colSpan={totalCols} className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C60 }}>
                          60-Day Target
                        </span>
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded"
                          style={{ background: `${C60}18`, color: C60, border: `1px solid ${C60}30` }}>
                          Expiry {expiry(60)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {rows60.map((row, i) => <PricingRow key={`60-${i}`} row={row} showGarch={showGarch} />)}
                </>}

              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── 5. COMPARISON STRIP ──────────────────────────────────────────── */}
      <section>
        <SectionHeader label="Liquid vs. Illiquid Comparison" sub="Cross-stock vol sensitivity" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: `${lTick} Hist. Vol`,        value: fmtPct(comp?.hist_vol_pct?.liquid),                 color: T.a },
            { label: `${iTick} Hist. Vol`,         value: fmtPct(comp?.hist_vol_pct?.illiquid),              color: T.b },
            { label: `${lTick} Avg Price Dev`,     value: comp?.avg_price_deviation_pct?.liquid != null ? `${Number(comp.avg_price_deviation_pct.liquid).toFixed(2)}%` : "—", color: T.a },
            { label: `${iTick} Avg Price Dev`,     value: comp?.avg_price_deviation_pct?.illiquid != null ? `${Number(comp.avg_price_deviation_pct.illiquid).toFixed(2)}%` : "—", color: T.b },
            ...(showGarch && comp?.garch_vol_pct ? [
              { label: `${lTick} GARCH Vol`,       value: fmtPct(comp.garch_vol_pct.liquid),                color: T.a },
              { label: `${iTick} GARCH Vol`,        value: fmtPct(comp.garch_vol_pct.illiquid),             color: T.b },
              { label: `${lTick} Avg IV Spread`,    value: comp?.avg_iv_spread_pct?.liquid != null ? `${Number(comp.avg_iv_spread_pct.liquid).toFixed(2)}%` : "—", color: T.a },
              { label: `${iTick} Avg IV Spread`,    value: comp?.avg_iv_spread_pct?.illiquid != null ? `${Number(comp.avg_iv_spread_pct.illiquid).toFixed(2)}%` : "—", color: T.b },
            ] : []),
          ].map(({ label, value, color }) => (
            <StatCard key={label} label={label} value={value} accent={color} />
          ))}
        </div>
      </section>

      {/* ── 6. CHARTS ────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader label="Quantitative Analysis" sub="BSM curves · IV smile · IV surface" />

        {/* Row 1: BSM curve + IV smile */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">

          {/* BSM Price vs Strike */}
          <ChartCard title="BSM Price vs Strike" badge={curTick} height={250}>
            <ChartLegend items={[
              { color: C30,     label: "Call 30d" },
              { color: C30,     label: "Put 30d",   dash: "4 2" },
              { color: C60,     label: "Call 60d" },
              { color: C60,     label: "Put 60d",   dash: "4 2" },
            ]} />
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={bsmChartData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false} />
                <XAxis dataKey="kS" {...axisProps} minTickGap={50}
                  tickFormatter={v => `${Number(v).toFixed(2)}×`} />
                <YAxis {...axisProps} width={50} tickFormatter={v => `₹${Number(v).toFixed(0)}`} />
                <ReferenceLine x={1.00} stroke={T.axis} strokeDasharray="3 4" />
                <Tooltip {...tooltipProps}
                  formatter={(v, n) => [`₹${Number(v).toFixed(2)}`, n]}
                  labelFormatter={v => `K/S = ${Number(v).toFixed(3)}`} />
                <Line type="monotone" dataKey="call30" stroke={C30}  strokeWidth={1.5} dot={false} name="Call 30d" />
                <Line type="monotone" dataKey="put30"  stroke={C30}  strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Put 30d" />
                <Line type="monotone" dataKey="call60" stroke={C60}  strokeWidth={1.5} dot={false} name="Call 60d" />
                <Line type="monotone" dataKey="put60"  stroke={C60}  strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Put 60d" />
                {/* Actual data points */}
                <Scatter data={bsmDots.filter(d => d.type === "CALL" && d.mat === 30)}
                  dataKey="price" shape="circle" fill={C30} r={4} name="Call 30d pts" />
                <Scatter data={bsmDots.filter(d => d.type === "PUT" && d.mat === 30)}
                  dataKey="price" shape="circle" fill={C30} r={4} opacity={0.6} name="Put 30d pts" />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* IV Smile */}
          <ChartCard title="Implied Volatility Smile" badge="IV vs K/S" height={250}>
            <ChartLegend items={[
              { color: T.a, label: `${lTick} 30d` },
              { color: T.a, label: `${lTick} 60d`, dash: "4 2" },
              { color: T.b, label: `${iTick} 30d` },
              { color: T.b, label: `${iTick} 60d`, dash: "4 2" },
            ]} />
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false} />
                <XAxis type="number" dataKey="kS" {...axisProps}
                  domain={[0.82, 1.18]} tickCount={7}
                  tickFormatter={v => Number(v).toFixed(2)} />
                <YAxis type="number" dataKey="iv" {...axisProps} width={48}
                  tickFormatter={v => `${Number(v).toFixed(1)}%`} />
                <ReferenceLine x={1.00} stroke={T.axis} strokeDasharray="3 4" />
                <Tooltip {...tooltipProps}
                  formatter={(v, n) => [
                    n.includes("iv") ? `${Number(v).toFixed(2)}%` : Number(v).toFixed(3),
                    n.includes("iv") ? "IV" : "K/S",
                  ]}
                  labelFormatter={() => ""} />
                {/* Fitted smile curves */}
                <Line data={smileLiq30} type="monotone" dataKey="iv" stroke={T.a}
                  strokeWidth={1.8} dot={false} name={`${lTick} 30d`} legendType="none" />
                <Line data={smileLiq60} type="monotone" dataKey="iv" stroke={T.a}
                  strokeWidth={1.8} strokeDasharray="4 2" dot={false} name={`${lTick} 60d`} legendType="none" />
                <Line data={smileIll30} type="monotone" dataKey="iv" stroke={T.b}
                  strokeWidth={1.8} dot={false} name={`${iTick} 30d`} legendType="none" />
                <Line data={smileIll60} type="monotone" dataKey="iv" stroke={T.b}
                  strokeWidth={1.8} strokeDasharray="4 2" dot={false} name={`${iTick} 60d`} legendType="none" />
                {/* Actual IV data points */}
                <Scatter data={ivDotsLiq30} fill={T.a} name={`${lTick} 30d pts`} r={5} />
                <Scatter data={ivDotsLiq60} fill={T.a} opacity={0.5} name={`${lTick} 60d pts`} r={4} />
                <Scatter data={ivDotsIll30} fill={T.b} name={`${iTick} 30d pts`} r={5} />
                <Scatter data={ivDotsIll60} fill={T.b} opacity={0.5} name={`${iTick} 60d pts`} r={4} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Row 2: 3D IV Surface full-width */}
        <div className="rounded-lg overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
          <div className="flex items-center justify-between px-4 py-3"
            style={{ background: T.surfaceHi, borderBottom: `1px solid ${T.divider}` }}>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "#d0d0e0" }}>
              Implied Volatility Surface
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono" style={{ color: T.muted }}>
                Drag to rotate · Scroll to zoom
              </span>
              <span className="text-[9px] font-mono px-2 py-0.5 rounded"
                style={{ background: T.accentDim, color: T.accent, border: `1px solid ${T.accent}30` }}>
                3D · Interactive
              </span>
            </div>
          </div>

          {/* Surface tabs */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            {[
              { key: "liquid",   label: lTick, color: T.a, dim: T.aDim },
              { key: "illiquid", label: iTick, color: T.b, dim: T.bDim },
            ].map(({ key, label, color, dim }) => {
              const active = activeSurface === key
              return (
                <button key={key} onClick={() => setActiveSurface(key)}
                  className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] rounded transition-all duration-150"
                  style={{
                    background: active ? dim : "transparent",
                    color: active ? color : T.muted,
                    border: `1px solid ${active ? color + "40" : T.divider}`,
                  }}>
                  {label}
                </button>
              )
            })}
          </div>

          <div style={{ height: 420, padding: "8px 4px 4px" }}>
            {activeSurface === "liquid" && liqD?.spot ? (
              <IVSurfacePlot
                key={`liq-${liqD.spot}`}
                histVol={liqD.hist_vol_pct}
                pricingTable={liqD.pricing_table}
                spot={liqD.spot}
                ticker={lTick}
                themeColor={T.a}
              />
            ) : illD?.spot ? (
              <IVSurfacePlot
                key={`ill-${illD.spot}`}
                histVol={illD.hist_vol_pct}
                pricingTable={illD.pricing_table}
                spot={illD.spot}
                ticker={iTick}
                themeColor={T.b}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-[12px]" style={{ color: T.muted }}>
                Awaiting data...
              </div>
            )}
          </div>
        </div>

      </section>

    </div>
  )
}
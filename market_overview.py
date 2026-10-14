"""
Tổng quan thị trường (vnstock v4+).
Chạy: python -m uvicorn market_overview:app --port 8000 --reload
Mở trình duyệt: http://localhost:8000
"""
import os
import threading
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from vnstock import Market, Reference

INDICES = ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"]
TTL_INDEX = 60
TTL_STOCKS = 90
CHUNK = 60

market = Market()
ref = Reference()
app = FastAPI(title="Market Overview API (vnstock)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INDEX_NAMES = {
    "VNINDEX": "VN-Index",
    "VN30": "VN30",
    "HNXINDEX": "HNX-Index",
    "UPCOMINDEX": "UPCOM-Index"
}
INDEX_EXCHANGE = {
    "VNINDEX": "HOSE",
    "HNXINDEX": "HNX",
    "UPCOMINDEX": "UPCOM"
}
PRICE_LIMIT = {
    "HOSE": 7.0,
    "HNX": 10.0,
    "UPCOM": 15.0
}

# 11 nhóm ngành chính theo chuẩn ICB (khớp hoàn toàn mảng IND trong dashboard.html)
IND_NAMES = [
    'Tài chính', 'Bất động sản', 'Nguyên vật liệu', 'Công nghiệp',
    'Hàng tiêu dùng thiết yếu', 'Hàng tiêu dùng không thiết yếu',
    'Năng lượng', 'Tiện ích', 'Y tế', 'Công nghệ thông tin', 'Dịch vụ truyền thông'
]

_IND_RULES = [
    (5, ["không thiết yếu", "discretionary", "retail", "bán lẻ", "automobile", "ô tô", "travel", "du lịch"]),
    (4, ["thiết yếu", "staples", "food", "beverage", "thực phẩm", "personal"]),
    (10, ["telecom", "viễn thông", "media", "truyền thông"]),
    (9, ["technology", "công nghệ thông tin", "công nghệ"]),
    (8, ["health", "y tế", "pharma", "dược"]),
    (7, ["utilit", "tiện ích"]),
    (6, ["oil", "gas", "energy", "dầu", "năng lượng"]),
    (1, ["real estate", "bất động sản"]),
    (2, ["basic materials", "resources", "chemical", "nguyên vật liệu", "hóa chất"]),
    (3, ["industrial", "công nghiệp", "construction", "xây dựng"]),
    (0, ["bank", "insurance", "financial", "securit", "ngân hàng", "bảo hiểm", "tài chính", "chứng khoán"]),
]

DEFAULT_TOP_SYMBOLS = [
    'VCB','BID','CTG','TCB','MBB','VPB','ACB','STB','HDB','VIB','TPB','SHB','LPB','MSB','OCB',
    'SSI','VND','VCI','HCM','SHS','MBS','FTS','CTS','BSI','BVH',
    'VIC','VHM','VRE','NVL','KDH','PDR','DIG','DXG','NLG','KBC','IDC','CEO',
    'HPG','HSG','NKG','DGC','DPM','DCM','GVR','GMD','HVN',
    'FPT','CMG','MWG','FRT','PNJ','MSN','VNM','SAB','DBC',
    'GAS','PLX','BSR','PVD','PVS','POW','DHG'
]

def _norm(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    return df

def _pick(df: pd.DataFrame, key: str):
    ALIASES = {
        "symbol": ["symbol", "ticker", "code", "stock_code"],
        "name": ["organ_name", "company_name", "name", "short_name", "organ_short_name"],
        "exchange": ["exchange", "board", "com_group_code"],
        "price": ["close_price", "price", "match_price", "last_price", "close", "matchprice"],
        "ref": ["reference_price", "ref_price", "basic_price", "reference", "ref"],
        "pct": ["percent_change", "change_pct", "pct_change", "change_percent"],
        "chg": ["price_change", "change_price", "change"],
        "volume": ["volume_accumulated", "volume", "total_volume", "accumulated_volume", "total_vol", "match_vol"],
        "ceiling": ["ceiling_price", "ceiling"],
        "floor": ["floor_price", "floor"],
        "value": ["total_value", "val", "value", "match_val"],
    }
    return next((a for a in ALIASES.get(key, []) if a in df.columns), None)

def _col(df: pd.DataFrame, key: str):
    c = _pick(df, key)
    return df[c] if c else pd.Series([None] * len(df), index=df.index)

# ---------- CHỈ SỐ THỊ TRƯỜNG ----------
def _index_snapshot(symbol: str) -> dict:
    end = date.today()
    start = (end - timedelta(days=60)).isoformat()
    try:
        idx_obj = market.index(symbol=symbol) if callable(market.index) else market.index
        df = idx_obj.ohlcv(start=start, end=end.isoformat())
    except Exception:
        df = market.index.ohlcv(symbol=symbol, start=start, end=end.isoformat())

    df = df.dropna(subset=["close"]).tail(30)
    last = df.iloc[-1]
    prev = df.iloc[-2]["close"] if len(df) > 1 else last["close"]
    change = float(last["close"] - prev)
    return {
        "symbol": symbol,
        "close": float(last["close"]),
        "change": round(change, 2),
        "change_pct": round(change / float(prev) * 100, 2) if prev else 0.0,
        "volume": int(last["volume"]) if "volume" in df.columns else None,
        "ref": round(float(prev), 2),
        "history": [round(float(x), 2) for x in df["close"]],
        "labels": (
            [pd.to_datetime(t).strftime("%d/%m") for t in df["time"]]
            if "time" in df.columns
            else None
        ),
    }

# ---------- DANH SÁCH CỔ PHIẾU & GIÁ ----------
def _universe() -> pd.DataFrame:
    try:
        eq = ref.equity() if callable(ref.equity) else ref.equity
        df = _norm(eq.list_by_exchange())
    except Exception:
        try:
            eq = ref.equity() if callable(ref.equity) else ref.equity
            df = _norm(eq.list())
        except Exception:
            df = pd.DataFrame({"symbol": DEFAULT_TOP_SYMBOLS})
    return df

def _quote(symbols: list) -> pd.DataFrame:
    try:
        return _norm(market.quote(symbols))
    except Exception:
        try:
            eq = market.equity() if callable(market.equity) else market.equity
            return _norm(eq.quote(symbols=symbols))
        except Exception:
            return pd.DataFrame()

def _industry_map() -> dict:
    """symbol -> (chỉ số ngành 0..10 hoặc None, tên ngành)"""
    try:
        eq = ref.equity() if callable(ref.equity) else ref.equity
        df = _norm(eq.list_by_industry())
        sc = _pick(df, "symbol")
        txt = [c for c in df.columns if c != sc and not pd.api.types.is_numeric_dtype(df[c]) and any(k in c for k in ("icb", "industry", "sector", "ngành"))]
        if not sc or not txt:
            return {}
        out = {}
        for _, r in df.iterrows():
            label = str(r[txt[0]]).lower()
            idx = next((i for i, keys in _IND_RULES if any(k in label for k in keys)), None)
            sub = str(r[txt[1]]) if len(txt) > 1 else str(r[txt[0]])
            out[str(r[sc]).upper()] = (idx, sub)
        return out
    except Exception:
        return {}

def _vn30_members() -> set:
    try:
        idx = ref.index() if callable(ref.index) else ref.index
        df = _norm(idx.members(symbol="VN30"))
        sc = _pick(df, "symbol")
        return set(df[sc].astype(str).str.upper()) if sc else set()
    except Exception:
        return set([
            'ACB','BCM','BID','BVH','CTG','FPT','GAS','GVR','HDB','HPG',
            'MBB','MSN','MWG','PLX','POW','SAB','SHB','SSB','SSI','STB',
            'TCB','TPB','VCB','VHM','VIB','VIC','VJC','VNM','VPB','VRE'
        ])

def _build_stocks() -> dict:
    uni = _universe()
    sym_c = _pick(uni, "symbol")
    if sym_c:
        uni = uni.rename(columns={sym_c: "symbol"})
        uni["symbol"] = uni["symbol"].astype(str).str.upper()
        uni = uni.drop_duplicates("symbol")
    else:
        uni = pd.DataFrame({"symbol": DEFAULT_TOP_SYMBOLS})

    ex_c, name_c = _pick(uni, "exchange"), _pick(uni, "name")
    meta = {
        r["symbol"]: (
            str(r[ex_c]).upper() if ex_c else "",
            str(r[name_c]) if name_c else "",
        )
        for _, r in uni.iterrows()
    }

    # Đảm bảo các mã top symbols luôn có trong danh sách
    all_syms = list(dict.fromkeys(DEFAULT_TOP_SYMBOLS + list(meta.keys())))

    frames = []
    # Lấy trước top symbols
    top_q = _quote(DEFAULT_TOP_SYMBOLS)
    if not top_q.empty:
        frames.append(top_q)

    # Lấy thêm các mã khác nếu cần
    remaining = [s for s in all_syms if s not in DEFAULT_TOP_SYMBOLS][:120]
    for i in range(0, len(remaining), CHUNK):
        try:
            q = _quote(remaining[i : i + CHUNK])
            if not q.empty:
                frames.append(q)
        except Exception:
            continue

    if not frames:
        raise RuntimeError("Không thể lấy dữ liệu bảng giá cổ phiếu")

    q = pd.concat(frames).drop_duplicates("symbol")
    sc = _pick(q, "symbol")
    if sc and sc != "symbol":
        q = q.rename(columns={sc: "symbol"})
    q["symbol"] = q["symbol"].astype(str).str.upper()

    out = pd.DataFrame({"symbol": q["symbol"]})
    out["price"] = pd.to_numeric(_col(q, "price"), errors="coerce")
    out["ref"] = pd.to_numeric(_col(q, "ref"), errors="coerce")
    out["chg"] = pd.to_numeric(_col(q, "chg"), errors="coerce")
    out["pct"] = pd.to_numeric(_col(q, "pct"), errors="coerce")
    out["volume"] = pd.to_numeric(_col(q, "volume"), errors="coerce")
    out["total_value"] = pd.to_numeric(_col(q, "value"), errors="coerce")
    out["ceiling"] = pd.to_numeric(_col(q, "ceiling"), errors="coerce")
    out["floor"] = pd.to_numeric(_col(q, "floor"), errors="coerce")

    # Đổi đơn vị về nghìn đồng nếu giá trả về là đồng (vd 32950 -> 32.95)
    if out["price"].median() and out["price"].median() > 1000:
        for c in ("price", "ref", "chg", "ceiling", "floor"):
            out[c] = out[c] / 1000

    if out["chg"].isna().all() and out["price"].notna().any() and out["ref"].notna().any():
        out["chg"] = out["price"] - out["ref"]
    if out["pct"].isna().all() and out["chg"].notna().any() and out["ref"].notna().any():
        out["pct"] = out["chg"] / out["ref"] * 100

    out["exchange"] = out["symbol"].map(lambda s: meta.get(s, ("", ""))[0] or ("HNX" if s in ['SHS','CEO','IDC'] else "HOSE"))
    out["name"] = out["symbol"].map(lambda s: meta.get(s, ("", ""))[1] or s)
    out = out[out["price"].notna() & (out["price"] > 0)]

    rows = (
        out[["symbol", "name", "exchange", "price", "chg", "pct", "volume", "total_value"]]
        .round(2)
        .where(pd.notna(out[["symbol", "name", "exchange", "price", "chg", "pct", "volume", "total_value"]]), None)
        .to_dict("records")
    )
    return {"updated_at": int(time.time()), "rows": rows}

def _breadth(sel: list) -> dict:
    adv = dec = nc = ceil = floor = 0
    val = 0.0
    for s in sel:
        p = s.get("pct") or 0
        lim = PRICE_LIMIT.get(s.get("exchange"), 7.0) - 0.05
        if p > 0:
            adv += 1
            ceil += int(p >= lim)
        elif p < 0:
            dec += 1
            floor += int(p <= -lim)
        else:
            nc += 1
        tv = s.get("total_value")
        if tv:
            val += tv / 1e9
        else:
            val += (s.get("price") or 0) * (s.get("volume") or 0) / 1e6
    return {"adv": adv, "ceil": int(ceil), "nc": nc, "dec": dec, "floor": int(floor), "val": round(val, 2)}

# ---------- CACHE ----------
_lock = threading.RLock()
_cache = {}

def _cached(key, ttl, fn):
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        data = fn()
        _cache[key] = (time.time(), data)
        return data

def _overview():
    indices = []
    for s in INDICES:
        try:
            indices.append(_index_snapshot(s))
        except Exception as e:
            indices.append({"symbol": s, "error": str(e)})
    return {"updated_at": int(time.time()), "indices": indices}

def _build_dashboard() -> dict:
    st = _cached("stocks", TTL_STOCKS, _build_stocks)
    ov = _cached("overview", TTL_INDEX, _overview)
    rows = st["rows"]
    ind = _cached("industry", 6 * 3600, _industry_map)
    vn30 = _cached("vn30", 6 * 3600, _vn30_members)

    stocks = []
    for r in rows:
        price, vol = r["price"], (r.get("volume") or 0)
        i = ind.get(r["symbol"], (None, None))
        stocks.append({
            "code": r["symbol"],
            "name": r["name"] or r["symbol"],
            "ex": r["exchange"] or "HOSE",
            "price": price,
            "d1": r.get("pct"),
            "val": round((r.get("total_value") or (price * vol * 1000)) / 1e9, 2),
            "ind": i[0],
            "sub": i[1],
        })

    indices = []
    for x in ov["indices"]:
        if x.get("error"):
            continue
        sid = x["symbol"]
        if sid == "VN30":
            sel = [r for r in rows if r["symbol"] in vn30]
        else:
            sel = [r for r in rows if r.get("exchange") == INDEX_EXCHANGE.get(sid)]
        b = _breadth(sel) if sel else {}
        vol = x.get("volume")
        indices.append({
            "id": sid,
            "name": INDEX_NAMES.get(sid, sid),
            "ref": x["ref"],
            "close": x["close"],
            "vol": round(vol / 1e6, 1) if vol else None,
            "val": b.get("val"),
            "pt": None,
            "adv": b.get("adv", 0),
            "ceil": b.get("ceil", 0),
            "nc": b.get("nc", 0),
            "dec": b.get("dec", 0),
            "floor": b.get("floor", 0),
            "series": x["history"],
            "labels": x.get("labels"),
        })
    return {"updated_at": int(time.time()), "indices": indices, "stocks": stocks}

# ---------- API ROUTES ----------
@app.get("/")
@app.get("/dashboard.html")
def home():
    html_path = Path(__file__).parent / "dashboard.html"
    return FileResponse(html_path)

@app.get("/api/dashboard")
def dashboard():
    try:
        return _cached("dashboard", TTL_INDEX, _build_dashboard)
    except Exception as e:
        return {"error": str(e), "indices": [], "stocks": []}

@app.get("/api/market-overview")
def market_overview_route():
    return _cached("overview", TTL_INDEX, _overview)

@app.get("/api/stocks")
def stocks_route():
    try:
        return _cached("stocks", TTL_STOCKS, _build_stocks)
    except Exception as e:
        return {"error": str(e), "rows": []}

@app.get("/api/debug")
def debug():
    return {
        "status": "online",
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "indices_supported": INDICES,
        "sample_top_symbols": DEFAULT_TOP_SYMBOLS[:10]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("market_overview:app", host="0.0.0.0", port=8000, reload=True)

require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

function isZeroAddress(addr) {
  return /^0x0{40}$/i.test(addr);
}

function normalizeDexChain(chain) {
  const c = (chain || "").toLowerCase();
  const map = {
    eth: "ethereum",
    ethereum: "ethereum",
    base: "base",
    bsc: "bsc",
    polygon: "polygon",
    arbitrum: "arbitrum",
    optimism: "optimism",
    solana: "solana"
  };
  return map[c] || "ethereum";
}

// DexScreener: 토큰 주소 -> 풀(페어) 목록
// 문서: /token-pairs/v1/{chainId}/{tokenAddress} :contentReference[oaicite:5]{index=5}
async function fetchDexTopPool(tokenAddress, chain) {
  const chainId = normalizeDexChain(chain);
  const url = `https://api.dexscreener.com/token-pairs/v1/${chainId}/${tokenAddress}`;

  const resp = await axios.get(url, { timeout: 8000 });
  const pairs = Array.isArray(resp.data) ? resp.data : [];

  if (!pairs.length) return null;

  // 유동성(USD) 가장 큰 페어 선택
  let best = null;
  for (const p of pairs) {
    const liq = p?.liquidity?.usd != null ? Number(p.liquidity.usd) : 0;
    if (!best || liq > (best.liquidity?.usd ? Number(best.liquidity.usd) : 0)) best = p;
  }

  if (!best) return null;

  return {
    chainId,
    pairAddress: best.pairAddress,
    dexId: best.dexId,
    priceUsd: best.priceUsd != null ? Number(best.priceUsd) : null,
    liquidityUsd: best.liquidity?.usd != null ? Number(best.liquidity.usd) : 0,
    volume24h: best.volume?.h24 != null ? Number(best.volume.h24) : null,
    txns24h: best.txns?.h24 || null
  };
}

// Bitquery: TokenHolders는 date/tokenSmartContract가 필수 :contentReference[oaicite:6]{index=6}
// 인증은 Authorization: Bearer <token> 방식 권장 :contentReference[oaicite:7]{index=7}
async function fetchHoldersBitquery(tokenAddress) {
  const token = process.env.BITQUERY_TOKEN; // Render 환경변수로 넣기
  if (!token) return null;

  const url = "https://streaming.bitquery.io/graphql"; // 문서 예시 :contentReference[oaicite:8]{index=8}
  const today = new Date().toISOString().slice(0, 10);

  const query = `
    query($token: String!, $date: String!) {
      EVM(dataset: archive) {
        TokenHolders(
          tokenSmartContract: $token
          date: $date
          limit: { count: 50 }
          where: { Balance: { Amount: { gt: "0" } } }
        ) {
          Holder { Address }
          Balance { Amount }
        }
      }
    }
  `;

  const resp = await axios.post(
    url,
    { query, variables: { token: tokenAddress, date: today } },
    {
      timeout: 12000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    }
  );

  const holders = resp.data?.data?.EVM?.TokenHolders;
  return Array.isArray(holders) ? holders : null;
}

function computeHolderConcentration(holders) {
  if (!holders || !holders.length) return null;

  const amounts = holders
    .map(h => Number(h?.Balance?.Amount || 0))
    .filter(n => Number.isFinite(n) && n > 0);

  if (!amounts.length) return null;

  amounts.sort((a, b) => b - a);
  const total = amounts.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;

  const top1 = amounts[0];
  return top1 / total;
}

// 매우 단순한 슬리피지 근사(거래 규모/유동성 비율 기반)
// 실제 프로덕션은 “페어의 reserve”로 AMM 공식을 쓰는 쪽이 더 정확하지만,
// 지금은 빠른 MVP용으로 tradeUsd 대비 liquidityUsd로 근사
function estimateSlippage(liquidityUsd, tradeUsd) {
  const L = Number(liquidityUsd || 0);
  const T = Number(tradeUsd || 0);
  if (!Number.isFinite(L) || L <= 0 || !Number.isFinite(T) || T <= 0) return null;
  const s = T / (L + T); // 0~1
  return Math.min(Math.max(s, 0), 1);
}

function computeRisk({ liquidityUsd, holderConc }) {
  const flags = [];
  let score = "LOW";

  if (liquidityUsd <= 0) flags.push("NO_DEX_LIQUIDITY");
  else if (liquidityUsd < 3000) flags.push("LOW_LIQUIDITY");
  else if (liquidityUsd < 10000) flags.push("MEDIUM_LIQUIDITY");

  if (holderConc == null) {
    flags.push("HOLDER_DATA_UNAVAILABLE");
  } else {
    if (holderConc > 0.4) flags.push("TOP_HOLDER_CONCENTRATED");
    else if (holderConc > 0.25) flags.push("TOP_HOLDER_MODERATE");
  }

  // 점수 룰 (MVP)
  if (liquidityUsd < 3000 || holderConc > 0.4) score = "HIGH";
  else if (liquidityUsd < 10000 || holderConc > 0.25) score = "MEDIUM";

  const recommendation = score === "HIGH" ? "AVOID" : score === "MEDIUM" ? "CAUTION" : "OK";
  return { score, recommendation, flags };
}

app.post("/api/risk", async (req, res) => {
  try {
    const { tokenAddress, chain = "ethereum", tradeUsd = 100 } = req.body;

    if (!tokenAddress || typeof tokenAddress !== "string") {
      return res.status(400).json({ error: "tokenAddress is required" });
    }
    if (!tokenAddress.startsWith("0x") || tokenAddress.length !== 42 || isZeroAddress(tokenAddress)) {
      return res.status(400).json({ error: "invalid tokenAddress" });
    }

    // 1) DEX 유동성/가격
    const topPool = await fetchDexTopPool(tokenAddress, chain);
    const liquidityUsd = topPool?.liquidityUsd || 0;

    // 2) 홀더 분포 (실패해도 서비스는 계속)
    let holders = null;
    try {
      holders = await fetchHoldersBitquery(tokenAddress);
    } catch (e) {
      console.error("Bitquery error:", e.response?.status, e.response?.data || e.message);
      holders = null;
    }
    const holderConc = computeHolderConcentration(holders);

    // 3) 슬리피지
    const slippage = estimateSlippage(liquidityUsd, tradeUsd);

    // 4) 리스크 스코어
    const { score, recommendation, flags } = computeRisk({ liquidityUsd, holderConc });

    return res.json({
      token: tokenAddress,
      chain: normalizeDexChain(chain),
      dex: topPool
        ? {
            dexId: topPool.dexId,
            pairAddress: topPool.pairAddress,
            priceUsd: topPool.priceUsd,
            liquidityUsd: topPool.liquidityUsd,
            volume24h: topPool.volume24h,
            txns24h: topPool.txns24h
          }
        : null,
      holderConcentrationTop1: holderConc,
      tradeUsd,
      slippage_estimate: slippage,
      risk_score: score,
      recommendation,
      flags
    });
  } catch (e) {
    console.error("RISK ERROR:", e.response?.data || e.message || e);
    return res.status(500).json({ error: "internal_error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on port", port));
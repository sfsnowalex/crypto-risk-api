require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

/* ===============================
   체인 매핑
================================ */

function normalizeChain(chain) {
  const c = (chain || "").toLowerCase();
  const map = {
    ethereum: { dex: "ethereum", etherscan: "https://api.etherscan.io/api" },
    eth: { dex: "ethereum", etherscan: "https://api.etherscan.io/api" },
    bsc: { dex: "bsc", etherscan: "https://api.bscscan.com/api" },
    polygon: { dex: "polygon", etherscan: "https://api.polygonscan.com/api" },
    base: { dex: "base", etherscan: null } // base는 etherscan 없음 (현재 기준)
  };
  return map[c] || map["ethereum"];
}

/* ===============================
   DexScreener 유동성/가격 조회
================================ */

async function fetchDexLiquidity(tokenAddress, chain) {
  const chainInfo = normalizeChain(chain);
  const url = `https://api.dexscreener.com/token-pairs/v1/${chainInfo.dex}/${tokenAddress}`;

  try {
    const resp = await axios.get(url, { timeout: 8000 });
    const pairs = Array.isArray(resp.data) ? resp.data : [];
    if (!pairs.length) return null;

    let best = null;
    for (const p of pairs) {
      const liq = Number(p?.liquidity?.usd || 0);
      if (!best || liq > Number(best?.liquidity?.usd || 0)) {
        best = p;
      }
    }

    return {
      liquidityUsd: Number(best?.liquidity?.usd || 0),
      priceUsd: Number(best?.priceUsd || 0),
      volume24h: Number(best?.volume?.h24 || 0),
      txns24h: best?.txns?.h24 || null,
      dexId: best?.dexId,
      pairAddress: best?.pairAddress
    };
  } catch (e) {
    console.error("Dex error:", e.message);
    return null;
  }
}

/* ===============================
   Etherscan 상위 홀더 조회
================================ */

async function fetchTopHolders(tokenAddress, chain) {
  const chainInfo = normalizeChain(chain);
  if (!chainInfo.etherscan) return null;
  if (!process.env.ETHERSCAN_API_KEY) return null;

  try {
    const url = `${chainInfo.etherscan}?module=token&action=tokenholderlist&contractaddress=${tokenAddress}&page=1&offset=10&apikey=${process.env.ETHERSCAN_API_KEY}`;
    const resp = await axios.get(url, { timeout: 8000 });

    if (resp.data.status !== "1") return null;

    return resp.data.result;
  } catch (e) {
    console.error("Etherscan error:", e.message);
    return null;
  }
}

/* ===============================
   홀더 집중도 계산
================================ */

function computeHolderConcentration(holders) {
  if (!holders || !holders.length) return null;

  const balances = holders.map(h => Number(h.TokenHolderQuantity || 0));
  const total = balances.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return null;

  balances.sort((a, b) => b - a);
  return balances[0] / total;
}

/* ===============================
   슬리피지 추정 (단순 AMM 근사)
================================ */

function estimateSlippage(liquidityUsd, tradeUsd) {
  if (!liquidityUsd || liquidityUsd <= 0) return null;
  return tradeUsd / (liquidityUsd + tradeUsd);
}

/* ===============================
   리스크 계산 로직
================================ */

function computeRisk(liquidityUsd, holderConc) {
  let score = "LOW";
  const flags = [];

  if (liquidityUsd <= 0) {
    score = "HIGH";
    flags.push("NO_LIQUIDITY");
  } else if (liquidityUsd < 3000) {
    score = "HIGH";
    flags.push("LOW_LIQUIDITY");
  } else if (liquidityUsd < 10000) {
    score = "MEDIUM";
    flags.push("MEDIUM_LIQUIDITY");
  }

  if (holderConc != null) {
    if (holderConc > 0.4) {
      score = "HIGH";
      flags.push("TOP_HOLDER_CONCENTRATED");
    } else if (holderConc > 0.25) {
      score = score === "HIGH" ? "HIGH" : "MEDIUM";
      flags.push("MODERATE_HOLDER_CONCENTRATION");
    }
  } else {
    flags.push("HOLDER_DATA_UNAVAILABLE");
  }

  const recommendation =
    score === "HIGH" ? "AVOID" :
    score === "MEDIUM" ? "CAUTION" :
    "OK";

  return { score, recommendation, flags };
}

/* ===============================
   API 엔드포인트
================================ */

app.post("/api/risk", async (req, res) => {
  try {
    const { tokenAddress, chain = "ethereum", tradeUsd = 100 } = req.body;

    if (!tokenAddress || tokenAddress.length !== 42) {
      return res.status(400).json({ error: "Invalid tokenAddress" });
    }

    // 1. DEX 데이터
    const dex = await fetchDexLiquidity(tokenAddress, chain);
    const liquidityUsd = dex?.liquidityUsd || 0;

    // 2. 홀더 데이터
    const holders = await fetchTopHolders(tokenAddress, chain);
    const holderConc = computeHolderConcentration(holders);

    // 3. 슬리피지
    const slippage = estimateSlippage(liquidityUsd, tradeUsd);

    // 4. 리스크 점수
    const { score, recommendation, flags } =
      computeRisk(liquidityUsd, holderConc);

    return res.json({
      token: tokenAddress,
      chain,
      dex,
      holderConcentrationTop1: holderConc,
      tradeUsd,
      slippage_estimate: slippage,
      risk_score: score,
      recommendation,
      flags
    });

  } catch (e) {
    console.error("RISK ERROR:", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on port", port));
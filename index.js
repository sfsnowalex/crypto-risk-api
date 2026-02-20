require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Web3 } = require("web3");
const app = express();
app.use(express.json());

const web3 = new Web3(process.env.RPC_URL);

// DexScreener 기반 유동성 가져오기
async function fetchDexLiquidity(tokenAddress, chain) {
  const url = `https://api.dexscreener.com/latest/dex/pairs/${chain}/${tokenAddress}`;
  const resp = await axios.get(url);
  const pair = resp.data.pairs?.[0];
  if (!pair) return null;
  
  return {
    liquidityUSD: parseFloat(pair.liquidity.usd),
    priceUsd: parseFloat(pair.priceUsd)
  };
}

// Bitquery 기반 홀더 가져오기 (GraphQL)
async function fetchHoldersBitquery(tokenAddress) {
  const API_URL = "https://graphql.bitquery.io/";
  const query = `
    query tokenHolders {
      EVM {
        TokenHolders(
          tokenAddress: "${tokenAddress}"
          limit: { count: 50 }
        ) {
          Holder {
            Address
          }
          Balance {
            Amount
          }
        }
      }
    }
  `;
  const resp = await axios.post(API_URL, { query }, {
    headers: { "X-API-KEY": process.env.BITQUERY_API_KEY }
  });
  return resp.data.data.EVM.TokenHolders;
}

// 간단 리스크 계산
function computeRisk(liquidityUSD, holders) {
  let holderConc = 0;
  if (holders && holders.length) {
    const totalBal = holders.reduce((sum, h) => sum + parseFloat(h.Balance.Amount), 0);
    const top1 = parseFloat(holders[0].Balance.Amount);
    holderConc = top1 / totalBal;
  }

  let score = "LOW";
  if (liquidityUSD < 3000 || holderConc > 0.4) score = "HIGH";
  else if (liquidityUSD < 10000 || holderConc > 0.25) score = "MEDIUM";
  
  return { score, holderConc };
}

app.post("/api/risk", async (req, res) => {
  try {
    const { tokenAddress, chain = "ethereum" } = req.body;
    if (!tokenAddress) {
      return res.status(400).json({ error: "tokenAddress is required" });
    }

    // 유동성 & 가격
    const dexData = await fetchDexLiquidity(tokenAddress, chain);
    const liquidityUSD = dexData?.liquidityUSD || 0;

    // 홀더 분포
    const holders = await fetchHoldersBitquery(tokenAddress);

    // 리스크 계산
    const { score, holderConc } = computeRisk(liquidityUSD, holders);

    const response = {
      token: tokenAddress,
      chain,
      liquidityUSD,
      holderConcentration: holderConc,
      risk_score: score,
      slippage_estimate: dexData?.priceUsd ? (1 / dexData.priceUsd) * 0.01 : 0,
      flags: [
        liquidityUSD < 3000 && "LOW_LIQUIDITY",
        holderConc > 0.4 && "TOP_HOLDER_CONCENTRATED"
      ].filter(Boolean)
    };

    return res.json(response);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "internal_error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server running", port);
});
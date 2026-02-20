require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// 간단 헬퍼 함수
function simpleRiskClassification(liquidity, holderConcentration) {
  if (liquidity < 1000 || holderConcentration > 0.5) return "HIGH";
  if (liquidity < 5000 || holderConcentration > 0.3) return "MEDIUM";
  return "LOW";
}

// API 엔드포인트
app.post("/api/risk", async (req, res) => {
  try {
    const { tokenAddress, chain } = req.body;

    if (!tokenAddress) {
      return res.status(400).json({
        error: "tokenAddress is required"
      });
    }

    // --- 1) 예시: 온체인 유동성 추출 (여기선 더미값 사용)
    const liquidity = Math.random() * 10000;

    // --- 2) 예시: 홀더 집중도 (더미값)
    const holderConcentration = Math.random();

    // --- 3) 리스크 계산
    const riskScore = simpleRiskClassification(liquidity, holderConcentration);

    // --- 4) 슬리피지 예상 (간단 비율 계산)
    const slippageEstimate = +(Math.random() * 0.05).toFixed(4);

    const response = {
      risk_score: riskScore,
      liquidity_warning:
        liquidity < 2000 ? "HIGH" : liquidity < 5000 ? "MEDIUM" : "LOW",
      slippage_estimate: slippageEstimate,
      ownership_concentration:
        holderConcentration > 0.4 ? "HIGH" : "LOW",
      recommendation:
        riskScore === "HIGH"
          ? "AVOID"
          : riskScore === "MEDIUM"
          ? "CAUTION"
          : "OK",
      flags: [
        liquidity < 2000 && "LOW_LIQUIDITY",
        holderConcentration > 0.4 && "HIGH_HOLDER_CONCENTRATION"
      ].filter(Boolean)
    };

    return res.json(response);
  } catch (e) {
    return res.status(500).json({ error: "internal_error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server running on port", port);
});

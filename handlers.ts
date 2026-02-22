import fetch from "node-fetch";

// 요구사항 검증 (필수 값 체크)
export function validateRequirements({ requirements }) {
  const { tokenAddress } = requirements;
  return (
    typeof tokenAddress === "string" &&
    tokenAddress.startsWith("0x") &&
    tokenAddress.length === 42
  );
}

// 실제 서비스 호출
export async function executeJob({ requirements }) {
  const { tokenAddress, chain = "ethereum", tradeUsd = 100 } = requirements;

  // Render에 올려둔 API 엔드포인트
  const url = `https://crypto-risk-api-9vcr.onrender.com/api/risk`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenAddress, chain, tradeUsd })
  });

  const data = await response.json();

  // ACP가 기대하는 형태로 반환
  return { result: data };
}

// 결제 처리 함수
export function requestPayment() {
  return true;
}
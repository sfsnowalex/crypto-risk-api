import fetch from "node-fetch";

// 요구사항 검증 (필수 값 체크)
export function validateRequirements({ requirements }) {
  const { address, tokenAddress } = requirements;
  const target = address || tokenAddress;

  return (
    typeof target === "string" &&
    target.startsWith("0x") &&
    target.length === 42
  );
}

// 실제 서비스 호출
export async function executeJob({ requirements }) {
  const {
    address,
    tokenAddress,
    chain = "ethereum",
    tradeUsd = 100,
    mode = address ? "sanctions" : "risk"
  } = requirements;
  const baseUrl = "https://crypto-risk-api-9vcr.onrender.com";

  const url =
    mode === "sanctions"
      ? `${baseUrl}/api/sanctions`
      : `${baseUrl}/api/risk`;

  const body =
    mode === "sanctions"
      ? { address: address || tokenAddress }
      : { tokenAddress: tokenAddress || address, chain, tradeUsd };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || "request_failed");
  }

  // ACP가 기대하는 형태로 반환
  return {
    result: {
      mode,
      ...data
    }
  };
}

// 결제 처리 함수
export function requestPayment() {
  return true;
}

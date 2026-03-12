# crypto-risk-api

## Endpoints

### `POST /api/risk`

기존 토큰 리스크 조회 엔드포인트입니다.

### `POST /api/sanctions`

주소가 제재 스크리닝에 걸리는지 `Chainalysis`와 `TRM`으로 조회합니다.

요청 예시:

```json
{
  "address": "0x1234567890abcdef1234567890abcdef12345678"
}
```

응답 예시:

```json
{
  "address": "0x1234567890abcdef1234567890abcdef12345678",
  "isSanctioned": false,
  "providers": {
    "chainalysis": {
      "provider": "chainalysis",
      "available": true,
      "isSanctioned": false
    },
    "trm": {
      "provider": "trm",
      "available": true,
      "isSanctioned": false
    }
  }
}
```

## Environment Variables

- `CHAINALYSIS_SANCTIONS_API_KEY`
- `CHAINALYSIS_SANCTIONS_BASE_URL` (optional, default: `https://public.chainalysis.com`)
- `TRM_SANCTIONS_BASE_URL` (optional, default: `https://api.trmlabs.com`)
- `TRM_SANCTIONS_API_KEY` (optional)
- `TRM_SANCTIONS_API_KEY_HEADER` (optional, default: `x-api-key`)
- `TRM_SANCTIONS_AUTH_SCHEME` (optional, for example `Bearer`)

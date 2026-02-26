# 16-bitbox

브라우저에서 레트로 비디오 게임 음악을 재생하는 웹 플레이어.
VGM(Video Game Music)과 SPC(SNES Sound Processor) 포맷을 지원합니다.

## 주요 기능

### 오디오 재생
- **VGM/VGZ** 포맷 재생 — VGMPlay WASM 엔진 사용 (OPL, OPN, PSG, SCC 등 다양한 칩셋 지원)
- **SPC** 포맷 재생 — snes_spc WASM 엔진 사용 (Super Nintendo 음원)
- ZIP 압축 아카이브 단위로 게임 앨범 관리 및 로드
- 페이드아웃 처리 후 다음 트랙 자동 재생

### 플레이어 UI
- 현재 재생 중인 트랙 정보 표시 (트랙명 / 게임명 / 시스템 / 작곡가)
- 주파수 스펙트럼 실시간 시각화 (Canvas 기반)
- 앨범 커버 이미지 표시 및 클릭 시 전체화면 확대
- 재생 / 일시정지 / 정지 / 이전·다음 트랙 컨트롤
- 트랙 목록에서 직접 선택 재생

### 키보드 단축키
| 키 | 동작 |
|----|------|
| `Space` | 재생 / 일시정지 |
| `N` | 다음 트랙 |
| `P` | 이전 트랙 |
| `S` | 정지 |
| `Esc` | 목록으로 돌아가기 |

### 게임 목록
- 검색창으로 타이틀명 · 시스템명 실시간 필터링
- ★ 즐겨찾기 등록 및 즐겨찾기 필터 (localStorage 저장)
- 한국어/일본어 타이틀 병기 지원

### URL 공유
- 현재 재생 중인 게임·트랙을 URL 쿼리 파라미터로 인코딩
- 공유 버튼으로 URL 클립보드 복사
- Vercel Edge Middleware로 OG 태그(제목·이미지) 동적 생성 → SNS 미리보기 지원

### PWA (Progressive Web App)
- 홈 화면에 앱으로 설치 가능
- Service Worker로 에셋 오프라인 캐시
- Media Session API 연동 — 잠금화면/알림바에서 재생 제어
- Screen Wake Lock — 재생 중 화면 자동 꺼짐 방지

## 기술 스택

| 구분 | 내용 |
|------|------|
| UI | React 19, Vite |
| 오디오 (VGM) | VGMPlay → Emscripten WASM + AudioWorklet |
| 오디오 (SPC) | snes_spc → Emscripten WASM + ScriptProcessorNode |
| ZIP 파싱 | Minizip (브라우저), JSZip (빌드 스크립트) |
| PWA | vite-plugin-pwa, Workbox |
| 배포 | Vercel (Edge Middleware) |

## 수록 타이틀

현재 **VGM 28개 / SPC 3개** 총 31개 타이틀 수록.

**VGM** — NES, MSX, MSX2, Sharp X68000, FM Towns, Sega Mega Drive/Genesis, IBM PC/AT(OPL/OPN) 등
**SPC** — Super Nintendo (Earthbound, Final Fantasy V, 삼국지 영걸전)

## 개발 환경 설정

```bash
npm install
npm run dev
```

### 음악 라이브러리 추가

1. `vgz/` 폴더에 VGM ZIP 파일 추가 (VGM/VGZ 파일 포함)
2. `spc/` 폴더에 SPC ZIP 파일 추가
3. 매니페스트 재생성:

```bash
npm run generate-manifest
```

커버 이미지(PNG/JPG)를 ZIP 안에 함께 넣으면 자동으로 앨범 아트와 OG 이미지가 생성됩니다.

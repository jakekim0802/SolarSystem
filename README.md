# Galactic Solar System Simulator

Three.js 기반 태양계 시뮬레이터입니다. 은하 중심을 도는 태양계, 행성별 중력 그리드, 목적지 행성까지의 스윙바이 전이 궤도, 그리고 타겟 행성 공전 진입을 시각화합니다.

## Local Development

```bash
npm install
npm run dev
```

개발 서버는 기본적으로 `http://127.0.0.1:5173/`에서 실행됩니다.

## Build

```bash
npm run build
```

정적 배포 산출물은 `dist/`에 생성됩니다.

## GitHub Pages Deployment

이 프로젝트는 무료 외부 테스트를 위해 GitHub Pages 배포를 기준으로 설정되어 있습니다.

1. GitHub에 public repository를 만듭니다.
2. 이 프로젝트를 `main` 브랜치로 push합니다.
3. GitHub repository의 `Settings > Pages`에서 source를 `GitHub Actions`로 설정합니다.
4. `.github/workflows/pages.yml` 워크플로가 `npm ci`와 `npm run build`를 실행한 뒤 `dist/`를 Pages에 배포합니다.

Vite의 `base`는 `./`로 설정되어 있어 `https://<user>.github.io/<repo>/` 형태의 GitHub Pages 하위 경로에서도 정적 asset이 깨지지 않습니다.

## Mobile QA Targets

- Mobile portrait: `390x844`, `360x800`
- Mobile landscape: `844x390`
- Tablet: `768x1024`
- Desktop: `1280x720`

모바일 세로모드는 핵심 조작만 먼저 보여주는 약식 모드이며, 설정 패널은 접힌 상태로 시작합니다. 모바일 가로모드는 기존 데스크톱 구도를 축소해 전체 태양계와 궤도가 잘 모이도록 구성합니다.

# HD800 — 800kV 내압기 설치 현장관리

HD현대일렉트릭 신설 시험실에 납품하는 800kV 내전압시험장비 설치공사(약 1개월) 동안 사용하는 임시 현장관리 웹앱입니다.
(주)액트투와 현대측 관계자가 링크로 접속해 함께 사용합니다. 로그인은 없으며, 작성자 이름만 입력합니다.

## 기능

| 화면 | 내용 |
|---|---|
| 대시보드 | 공사 기간·진행, 요청/문의 게시글 수·새 글, 최소 이격거리, 기본 배치안 미리보기, 이번 주 일정, 최근 변경 이력 |
| 배치도 | 건축 평면도 위 설비 배치 확인 · 벽체/기둥으로부터 3m/4m/5m 이격 영역 · 설비 드래그 이동/회전 · 설비별 벽체·기둥까지 최소거리 · 거리 측정 · 배치안 여러 개 저장/비교 |
| 일정 | 월간 달력(기간 막대)과 목록, 구분·상태·담당·메모 |
| 요청·문의 | 현대측 / 액트투측 게시판(요청사항·문의사항 구분), 작성자 이름, 답변 |

## 구조

- 정적 사이트 (빌드 없음): `index.html`, `css/`, `js/` — GitHub Pages로 배포
- 데이터: Supabase(LIRAsupabase 프로젝트)의 `hd800_*` 테이블. 공개 anon 키 + RLS로 `hd800_*` 테이블만 읽기/쓰기 허용
- 도면: `data/plan.json` — `설치 도면.dwg`를 `tools/convert-dwg.mjs`로 변환한 결과 (좌표 단위 mm)
  - 벽체 = 건축도면 레이어 lineweight 5, 기둥 = lineweight 7/9 (H형강·베이스플레이트를 사각형으로 병합)
  - 설비 초기 위치 = DWG의 `0`, `내압기 도면` 레이어

## 도면 갱신

```bash
cd tools
npm install
node convert-dwg.mjs "<경로>/설치 도면.dwg"
```

`data/plan.json`이 다시 만들어집니다. 저장된 배치안의 설비 위치는 DB에 있으므로 그대로 유지됩니다.

## 로컬 실행

```bash
python -m http.server 5800
```

## 공사 종료 후 정리

1. GitHub 저장소 보관(Archive) 또는 삭제, Pages 비활성화
2. Supabase SQL: `drop table hd800_comments, hd800_requests, hd800_schedule, hd800_layouts, hd800_activity; drop function hd800_touch;`

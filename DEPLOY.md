# 여기여기 모여라! 관련 성취기준 — 배포 안내

이 폴더는 그대로 Vercel에 올리는 정적 사이트입니다(빌드 과정 없음).
배포 전 점검은 마친 상태입니다: 보안 헤더, CSP 위반 0건, 방침·약관, 링크 미리보기, 휴대폰 폭.

## 1. 배포 (노트북에서 둘 중 하나)

**클로드 코드에게 맡기기**
이 폴더에서 클로드 코드를 열고 이렇게 말합니다.
> 이 폴더를 Vercel에 프로젝트 이름 special-edu-standards 로 프로덕션 배포해줘. 빌드 명령은 없어.

**터미널에서 직접**
```
cd (이 폴더)
npx vercel --prod
```
프로젝트 이름을 물으면 `special-edu-standards`를 넣고, 빌드 설정은 모두 기본값(없음)으로 둡니다.

## 2. 주소가 다르게 나오면

같은 이름이 이미 쓰이고 있으면 주소가 달라질 수 있습니다. 그때는 아래 세 파일에 있는
`https://special-edu-standards.vercel.app`을 실제 주소로 바꾸고 다시 배포합니다.
- index.html (canonical, og:url, og:image)
- privacy.html, terms.html (canonical, 본문의 서비스 주소)

한 번에 바꾸기 (macOS):
```
sed -i '' 's#https://special-edu-standards.vercel.app#https://실제주소#g' index.html privacy.html terms.html
```

## 3. 배포 뒤 확인

edu-app-launch 스킬의 `check_live.sh`로 확인합니다. 확인 항목은 헤더 5종, /privacy · /terms · /og.png 응답, 미리보기 메타입니다.

## 4. 데이터·엔진을 고쳤을 때

1. standards-finder 저장소에서 `python3 scripts/build_data.py`를 실행합니다.
2. `data/public/standards.min.json`, `data/public/synonyms.json`, `app/search.js`를 이 폴더에 덮어쓰고 다시 배포합니다.
3. 허브(special-edu-hub)에는 `scripts/sync_to_hub.sh`로 같은 파일을 보냅니다.

두 곳을 함께 갱신해야 검색 결과가 같게 나옵니다.

## 5. 앞으로 고칠 때 주의

외부 스크립트·글꼴·API를 새로 넣거나 저장·전송 기능을 추가하면,
`vercel.json`의 CSP와 `privacy.html`을 같이 고쳐야 합니다.

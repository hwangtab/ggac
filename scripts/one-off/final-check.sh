#!/bin/bash
echo "🔍 경기아트콜렉티브 웹사이트 종합 상태 체크"
echo "=============================================="

# 서버 응답 확인
echo "1. 서버 기본 응답 확인:"
curl -s -o /dev/null -w "   - 홈페이지: %{http_code} (%{size_download} bytes)\n" http://localhost:3000
curl -s -o /dev/null -w "   - 아티스트 페이지: %{http_code} (%{size_download} bytes)\n" http://localhost:3000/artists/
curl -s -o /dev/null -w "   - Simon DM 프로필: %{http_code} (%{size_download} bytes)\n" http://localhost:3000/artists/simon-dm/

echo ""
echo "2. 이미지 파일 확인:"
curl -s -o /dev/null -w "   - Simon DM 이미지: %{http_code} (%{size_download} bytes)\n" http://localhost:3000/images/artists/simon-dm.png
curl -s -o /dev/null -w "   - 로고 이미지: %{http_code} (%{size_download} bytes)\n" http://localhost:3000/images/logo/gac_logo.png

echo ""
echo "3. HTML 콘텐츠 분석:"
SIMON_REFS=$(curl -s http://localhost:3000 | grep -c "simon-dm.png")
IMG_TAGS=$(curl -s http://localhost:3000 | grep -c "<img.*simon-dm.png")
echo "   - Simon DM 이미지 참조: $SIMON_REFS 회"
echo "   - IMG 태그 개수: $IMG_TAGS 개"

echo ""
echo "4. 네트워크 성능:"
HOME_TIME=$(curl -s -o /dev/null -w "%{time_total}" http://localhost:3000)
IMAGE_TIME=$(curl -s -o /dev/null -w "%{time_total}" http://localhost:3000/images/artists/simon-dm.png)
echo "   - 홈페이지 로딩 시간: ${HOME_TIME}초"
echo "   - 이미지 로딩 시간: ${IMAGE_TIME}초"

echo ""
echo "5. 종합 평가:"
if [ "$SIMON_REFS" -ge 2 ] && [ "$IMG_TAGS" -ge 2 ]; then
    echo "   ✅ 이미지가 정상적으로 HTML에 포함되어 있습니다!"
    echo "   ✅ 브라우저에서 이미지가 표시될 준비가 완료되었습니다!"
else
    echo "   ⚠️ 이미지 참조에 문제가 있을 수 있습니다."
fi

echo ""
echo "📝 참고사항:"
echo "   - 브라우저 개발자 도구(F12)의 콘솔에서 'Image loaded successfully' 메시지를 확인하세요"
echo "   - 만약 이미지가 여전히 보이지 않는다면 브라우저 캐시를 클리어하세요"
echo ""

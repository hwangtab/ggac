/**
 * Middleware HTML Templates
 * 시스템 점검 및 회원가입 중단 등의 상황에서 보여줄 정적 HTML 템플릿
 */

export const getMaintenanceHtml = (message: string) => `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>시스템 점검 중 - 경기아트콜렉티브</title>
  <style>
    body {
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Helvetica Neue', 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #333;
    }
    .container {
      text-align: center;
      background: white;
      padding: 3rem;
      border-radius: 20px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.1);
      max-width: 500px;
      margin: 1rem;
    }
    h1 {
      font-size: 2rem;
      margin-bottom: 1rem;
      color: #667eea;
    }
    p {
      font-size: 1.1rem;
      line-height: 1.6;
      color: #666;
      margin-bottom: 2rem;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    .retry-btn {
      background: #667eea;
      color: white;
      border: none;
      padding: 1rem 2rem;
      border-radius: 10px;
      font-size: 1rem;
      cursor: pointer;
      transition: background 0.3s;
    }
    .retry-btn:hover {
      background: #5a67d8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🛠️</div>
    <h1>시스템 점검 중</h1>
    <p>${message}</p>
    <button class="retry-btn" onclick="window.location.reload()">새로고침</button>
  </div>
</body>
</html>
`

export const getRegistrationDisabledHtml = () => `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>회원 가입 일시 중단 - 경기아트콜렉티브</title>
  <style>
    body {
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      margin: 0; padding: 0; display: flex; justify-content: center; align-items: center;
      min-height: 100vh; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: #333;
    }
    .container { text-align: center; background: white; padding: 3rem; border-radius: 20px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.1); max-width: 500px; margin: 1rem; }
    h1 { font-size: 2rem; margin-bottom: 1rem; color: #f5576c; }
    p { font-size: 1.1rem; line-height: 1.6; color: #666; margin-bottom: 2rem; }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
    .home-btn { background: #f5576c; color: white; border: none; padding: 1rem 2rem;
      border-radius: 10px; font-size: 1rem; cursor: pointer; transition: background 0.3s;
      text-decoration: none; display: inline-block; }
    .home-btn:hover { background: #e14856; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🚫</div>
    <h1>회원 가입 일시 중단</h1>
    <p>현재 회원 가입이 일시 중단되었습니다.<br>양해 부탁드립니다.</p>
    <a href="/" class="home-btn">홈으로 돌아가기</a>
  </div>
</body>
</html>
`

// Vercel 배포 상태를 받는 Webhook API
export default async function handler(req, res) {
  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, payload } = req.body;
    
    // Vercel Webhook 이벤트 처리
    if (type === 'deployment') {
      await handleDeploymentEvent(payload);
    }

    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleDeploymentEvent(payload) {
  const { state, url, target, meta } = payload;
  
  // 프로덕션 배포만 알림
  if (target !== 'production') {
    return;
  }

  const deployUrl = url || 'https://ggac.kr';
  const commit = meta?.githubCommitSha?.substring(0, 7) || 'Unknown';
  const branch = meta?.githubCommitRef || 'Unknown';

  switch (state) {
    case 'BUILDING':
      await sendSlackNotification(createBuildingMessage(commit, branch));
      break;
    case 'READY':
      await sendSlackNotification(createSuccessMessage(deployUrl, commit, branch));
      break;
    case 'ERROR':
      await sendSlackNotification(createErrorMessage(commit, branch));
      break;
    case 'CANCELED':
      await sendSlackNotification(createCanceledMessage(commit, branch));
      break;
  }
}

function createBuildingMessage(commit, branch) {
  return `🚀 **GGAC 웹사이트** 배포 시작

📋 **배포 정보:**
• 브랜치: \`${branch}\`
• 커밋: \`${commit}\`
• 시간: ${new Date().toLocaleString('ko-KR')}

⏳ Vercel에서 빌드 중...`;
}

function createSuccessMessage(deployUrl, commit, branch) {
  return `✅ **GGAC 웹사이트** 배포 완료!

🎉 **배포 성공:**
• 브랜치: \`${branch}\`
• 커밋: \`${commit}\`
• URL: ${deployUrl}
• 완료 시간: ${new Date().toLocaleString('ko-KR')}

🔗 사이트 확인: ${deployUrl}`;
}

function createErrorMessage(commit, branch) {
  return `❌ **GGAC 웹사이트** 배포 실패

💥 **배포 실패:**
• 브랜치: \`${branch}\`
• 커밋: \`${commit}\`
• 실패 시간: ${new Date().toLocaleString('ko-KR')}

⚠️ Vercel 대시보드에서 로그를 확인해주세요.`;
}

function createCanceledMessage(commit, branch) {
  return `⏹️ **GGAC 웹사이트** 배포 취소

🔄 **배포 취소:**
• 브랜치: \`${branch}\`
• 커밋: \`${commit}\`
• 취소 시간: ${new Date().toLocaleString('ko-KR')}

ℹ️ 배포가 취소되었습니다.`;
}

async function sendSlackNotification(message) {
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackChannelId = process.env.SLACK_CHANNEL_ID || 'C093MGMC02E'; // #slack-전체

  if (!slackBotToken) {
    console.error('SLACK_BOT_TOKEN이 설정되지 않았습니다.');
    return;
  }

  const payload = {
    channel: slackChannelId,
    text: message,
    username: 'Vercel Deploy Bot',
    icon_emoji: ':vercel:'
  };

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!result.ok) {
      console.error('Slack 알림 전송 실패:', result.error);
    } else {
      console.log('Slack 알림 전송 성공');
    }
  } catch (error) {
    console.error('Slack API 호출 오류:', error);
  }
}
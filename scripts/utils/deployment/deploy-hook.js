// Vercel Deploy Hook을 받아서 Slack 알림을 보내는 API
export default async function handler(req, res) {
  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Deploy Hook이 트리거되면 배포 시작 알림 전송
    await sendSlackNotification(createDeployStartMessage())

    // Vercel Deploy Hook 트리거
    const deployResponse = await fetch(
      'https://api.vercel.com/v1/integrations/deploy/prj_gKX9zLcsyxU1udy08ob4AUOeZYmL/LykkHw6E67',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )

    if (deployResponse.ok) {
      res.status(200).json({ message: 'Deploy triggered and notification sent' })
    } else {
      res.status(500).json({ error: 'Deploy trigger failed' })
    }
  } catch (error) {
    console.error('Deploy hook processing error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

function createDeployStartMessage() {
  return `🚀 **GGAC 웹사이트** 배포 시작

📋 **배포 정보:**
• 트리거: Deploy Hook
• 시간: ${new Date().toLocaleString('ko-KR')}

⏳ Vercel에서 배포 중...`
}

async function sendSlackNotification(message) {
  const slackBotToken = process.env.SLACK_BOT_TOKEN
  const slackChannelId = process.env.SLACK_CHANNEL_ID || 'C094ELD4D4L' // #웹사이트

  if (!slackBotToken) {
    console.error('SLACK_BOT_TOKEN이 설정되지 않았습니다.')
    return
  }

  const payload = {
    channel: slackChannelId,
    text: message,
    username: 'Deploy Hook Bot',
    icon_emoji: ':vercel:',
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const result = await response.json()
    if (!result.ok) {
      console.error('Slack 알림 전송 실패:', result.error)
    } else {
      console.log('Slack 알림 전송 성공')
    }
  } catch (error) {
    console.error('Slack API 호출 오류:', error)
  }
}

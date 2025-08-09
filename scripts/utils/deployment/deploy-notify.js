#!/usr/bin/env node
const { exec } = require('child_process');

// 배포 상태 Slack 알림 스크립트
class DeployNotifier {
  constructor() {
    this.slackBotToken = process.env.SLACK_BOT_TOKEN;
    this.slackChannelId = process.env.SLACK_CHANNEL_ID || 'C094ELD4D4L';
    this.projectName = 'GGAC 웹사이트';
    this.deployUrl = 'https://ggac.kr';
  }

  async sendSlackMessage(message) {
    const payload = {
      channel: this.slackChannelId,
      text: message,
      username: 'Deploy Bot',
      icon_emoji: ':rocket:'
    };

    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.slackBotToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (result.ok) {
        console.log('✅ Slack 알림 전송 성공');
      } else {
        console.error('❌ Slack 알림 전송 실패:', result.error);
      }
    } catch (error) {
      console.error('❌ Slack API 호출 오류:', error.message);
    }
  }

  async getGitInfo() {
    return new Promise((resolve) => {
      exec('git log -1 --pretty=format:"%h %s" && echo "" && git branch --show-current', (error, stdout) => {
        if (error) {
          resolve({ commit: 'Unknown', branch: 'Unknown' });
        } else {
          const lines = stdout.trim().split('\n');
          const commit = lines[0] || 'Unknown';
          const branch = lines[1] || 'Unknown';
          resolve({ commit, branch });
        }
      });
    });
  }

  async notifyDeployStart() {
    const { commit, branch } = await this.getGitInfo();
    const message = `🚀 **${this.projectName}** 배포 시작
    
📋 **배포 정보:**
• 브랜치: \`${branch}\`
• 커밋: \`${commit}\`
• 시간: ${new Date().toLocaleString('ko-KR')}

⏳ 배포 중...`;

    await this.sendSlackMessage(message);
  }

  async notifyDeploySuccess(deployUrl = null) {
    const { commit, branch } = await this.getGitInfo();
    const finalUrl = deployUrl || this.deployUrl;
    const message = `✅ **${this.projectName}** 배포 완료!

🎉 **배포 성공:**
• 브랜치: \`${branch}\`
• 커밋: \`${commit}\`
• URL: ${finalUrl}
• 완료 시간: ${new Date().toLocaleString('ko-KR')}

🔗 사이트 확인: ${finalUrl}`;

    await this.sendSlackMessage(message);
  }

  async notifyDeployFailure(error = null) {
    const { commit, branch } = await this.getGitInfo();
    const message = `❌ **${this.projectName}** 배포 실패

💥 **배포 실패:**
• 브랜치: \`${branch}\`
• 커밋: \`${commit}\`
• 실패 시간: ${new Date().toLocaleString('ko-KR')}
${error ? `• 오류: \`${error}\`` : ''}

⚠️ 배포 로그를 확인해주세요.`;

    await this.sendSlackMessage(message);
  }
}

// 명령행 인자로 동작 결정
const action = process.argv[2];
const notifier = new DeployNotifier();

switch (action) {
  case 'start':
    notifier.notifyDeployStart();
    break;
  case 'success':
    const deployUrl = process.argv[3];
    notifier.notifyDeploySuccess(deployUrl);
    break;
  case 'failure':
    const error = process.argv[3];
    notifier.notifyDeployFailure(error);
    break;
  default:
    console.log('사용법: node deploy-notify.js [start|success|failure] [추가정보]');
    console.log('예시:');
    console.log('  node deploy-notify.js start');
    console.log('  node deploy-notify.js success https://ggac.kr');
    console.log('  node deploy-notify.js failure "Build failed"');
}
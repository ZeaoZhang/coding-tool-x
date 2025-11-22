<template>
  <div class="home-container">
    <div class="welcome-section">
      <div class="logo-area">
        <div class="logo-circle">
          <svg viewBox="0 0 100 100" class="logo-icon">
            <path d="M50 10 L90 30 L90 70 L50 90 L10 70 L10 30 Z" fill="none" stroke="currentColor" stroke-width="3"/>
            <circle cx="50" cy="50" r="20" fill="currentColor" opacity="0.2"/>
            <path d="M40 50 L48 58 L62 42" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 class="app-title">CODING-TOOL</h1>
        <p class="app-subtitle">Vibe Coding Enhancement Assistant</p>
      </div>

      <div class="channel-cards">
        <div class="channel-card" @click="goToChannel('claude')">
          <div class="card-header">
            <div class="card-icon claude-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3"/>
                <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <h3 class="card-title">Claude Code</h3>
          </div>
          <p class="card-desc">基于 Claude 的智能编程助手</p>
          <div class="card-footer">
            <span class="card-link">进入项目 →</span>
          </div>
        </div>

        <div class="channel-card" @click="goToChannel('codex')">
          <div class="card-header">
            <div class="card-icon codex-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
                <path d="M8 8L16 16M16 8L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </div>
            <h3 class="card-title">Codex</h3>
          </div>
          <p class="card-desc">高效的代码生成工具</p>
          <div class="card-footer">
            <span class="card-link">进入项目 →</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

function goToChannel(channel) {
  router.push({ name: `${channel}-projects` })
}
</script>

<style scoped>
.home-container {
  min-height: calc(100vh - 60px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  background: var(--bg-primary);
}

.welcome-section {
  max-width: 800px;
  width: 100%;
  text-align: center;
}

/* Logo 区域 */
.logo-area {
  margin-bottom: 60px;
}

.logo-circle {
  width: 120px;
  height: 120px;
  margin: 0 auto 24px;
  color: #18a058;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

.logo-icon {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 4px 12px rgba(24, 160, 88, 0.2));
}

[data-theme="dark"] .logo-icon {
  filter: drop-shadow(0 4px 16px rgba(24, 160, 88, 0.3));
}

.app-title {
  font-size: 48px;
  font-weight: 800;
  margin: 0 0 12px 0;
  background: linear-gradient(135deg, #18a058 0%, #36ad6a 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: -1px;
}

.app-subtitle {
  font-size: 16px;
  color: var(--text-tertiary);
  margin: 0;
  font-weight: 500;
}

/* 渠道卡片 */
.channel-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
  max-width: 600px;
  margin: 0 auto;
}

.channel-card {
  background: var(--bg-secondary);
  border: 2px solid var(--border-primary);
  border-radius: 16px;
  padding: 32px 24px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.channel-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #18a058 0%, #36ad6a 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.channel-card:hover {
  border-color: #18a058;
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(24, 160, 88, 0.15);
}

[data-theme="dark"] .channel-card:hover {
  box-shadow: 0 12px 24px rgba(24, 160, 88, 0.25);
}

.channel-card:hover::before {
  opacity: 1;
}

.card-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.card-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.claude-icon {
  background: rgba(24, 160, 88, 0.1);
  color: #18a058;
}

.codex-icon {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.channel-card:hover .card-icon {
  transform: scale(1.1) rotate(5deg);
}

.card-icon svg {
  width: 32px;
  height: 32px;
}

.card-title {
  font-size: 24px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
}

.card-desc {
  font-size: 14px;
  color: var(--text-tertiary);
  margin: 0 0 20px 0;
  line-height: 1.6;
}

.card-footer {
  margin-top: auto;
}

.card-link {
  font-size: 14px;
  font-weight: 600;
  color: #18a058;
  transition: all 0.2s ease;
}

.channel-card:hover .card-link {
  transform: translateX(4px);
  display: inline-block;
}

/* 响应式 */
@media (max-width: 768px) {
  .app-title {
    font-size: 36px;
  }

  .logo-circle {
    width: 100px;
    height: 100px;
  }

  .channel-cards {
    grid-template-columns: 1fr;
  }
}
</style>

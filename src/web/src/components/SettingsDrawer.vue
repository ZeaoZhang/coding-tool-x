<template>
  <n-drawer v-model:show="show" :width="drawerWidth" placement="right" :show-mask="true">
    <n-drawer-content :show-header="false" closable :native-scrollbar="false">
      <div class="settings-container">
        <!-- 左侧菜单 -->
        <div class="settings-sidebar">
          <div class="sidebar-header">
            <n-icon size="20" color="var(--text-secondary)">
              <SettingsOutline />
            </n-icon>
            <span class="sidebar-title">设置分类</span>
          </div>

          <div class="settings-menu">
            <div
              v-for="item in menuItems"
              :key="item.key"
              class="menu-item"
              :class="{ active: activeMenu === item.key }"
              @click="activeMenu = item.key"
            >
              <n-icon :size="18" class="menu-icon">
                <component :is="item.icon" />
              </n-icon>
              <span class="menu-label">{{ item.label }}</span>
              <n-badge
                v-if="item.badge"
                :value="item.badge"
                :type="item.badgeType || 'info'"
                :show-zero="false"
              />
            </div>
          </div>
        </div>

        <!-- 右侧内容 -->
        <div class="settings-content">
          <!-- 外观设置面板 -->
          <div v-show="activeMenu === 'appearance'" class="settings-panel">
            <div class="panel-header">
              <div class="panel-title-row">
                <n-icon size="24" color="var(--text-secondary)">
                  <ColorPaletteOutline />
                </n-icon>
                <div>
                  <h3 class="panel-title">外观设置</h3>
                  <n-text depth="3" class="panel-subtitle">自定义界面外观和主题</n-text>
                </div>
              </div>
            </div>
            <div class="panel-body">
              <div class="setting-group">
                <!-- 面板可见性设置 -->
                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>面板显示</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      控制右侧面板中各个区域的显示
                    </n-text>
                  </div>

                  <div class="visibility-options">
                    <!-- 显示渠道列表 -->
                    <div class="visibility-item">
                      <div class="visibility-info">
                        <n-text strong>显示渠道列表</n-text>
                        <n-text depth="3" style="font-size: 13px;">
                          在右侧面板显示 API 渠道管理区域
                        </n-text>
                      </div>
                      <n-switch
                        :value="showChannels"
                        @update:value="handleShowChannelsChange"
                      />
                    </div>

                    <!-- 显示日志 -->
                    <div class="visibility-item">
                      <div class="visibility-info">
                        <n-text strong>显示实时日志</n-text>
                        <n-text depth="3" style="font-size: 13px;">
                          在 Dashboard 显示实时日志区域
                        </n-text>
                      </div>
                      <n-switch
                        :value="showLogs"
                        @update:value="handleShowLogsChange"
                      />
                    </div>

                    <!-- 显示剩余金额 -->
                    <div class="visibility-item">
                      <div class="visibility-info">
                        <n-text strong>显示剩余金额</n-text>
                        <n-text depth="3" style="font-size: 13px;">
                          在渠道卡片显示可识别 API 网关的余额
                        </n-text>
                      </div>
                      <n-switch
                        :value="showChannelBalance"
                        @update:value="handleShowChannelBalanceChange"
                      />
                    </div>
                  </div>
                </div>

                <n-divider />

                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>首页 CLI 显示</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      固定四个槽位，默认是 Claude Code / Codex / Gemini / OpenCode；Pi 和自定义 CLI 可替换任一列
                    </n-text>
                  </div>

                  <div class="home-cli-settings">
                    <div class="home-cli-slots">
                      <div v-for="(_, index) in homeCliColumns" :key="index" class="home-cli-slot">
                        <n-text depth="3" style="font-size: 12px;">第 {{ index + 1 }} 列</n-text>
                        <n-select
                          :value="homeCliColumns[index]"
                          :options="homeCliOptions"
                          size="small"
                          @update:value="value => handleHomeCliSlotChange(index, value)"
                        />
                      </div>
                    </div>

                    <div class="custom-cli-list">
                      <div
                        v-for="(platform, index) in customCliPlatforms"
                        :key="platform.key || index"
                        class="custom-cli-item"
                      >
                        <div class="custom-cli-grid">
                          <n-input
                            v-model:value="platform.key"
                            size="small"
                            placeholder="key，如 aider"
                            @blur="normalizeCustomCliEdits"
                          />
                          <n-input
                            v-model:value="platform.name"
                            size="small"
                            placeholder="名称"
                          />
                          <n-input
                            v-model:value="platform.command"
                            size="small"
                            placeholder="启动命令"
                          />
                          <n-input
                            v-model:value="platform.configDir"
                            size="small"
                            placeholder="配置目录（可选）"
                          />
                          <n-input
                            v-model:value="platform.icon"
                            size="small"
                            placeholder="图标名（可选）"
                          />
                          <n-input
                            v-model:value="platform.color"
                            size="small"
                            placeholder="颜色（可选）"
                          />
                        </div>
                        <div class="custom-cli-actions">
                          <n-switch v-model:value="platform.enabled" size="small" />
                          <n-text depth="3" style="font-size: 12px;">可作为首页列</n-text>
                          <n-button text size="small" type="error" @click="removeCustomCliPlatform(index)">
                            <template #icon><n-icon><TrashOutline /></n-icon></template>
                          </n-button>
                        </div>
                      </div>
                    </div>

                    <div class="home-cli-actions">
                      <n-button size="small" @click="addCustomCliPlatform">
                        <template #icon><n-icon><AddOutline /></n-icon></template>
                        新增自定义 CLI
                      </n-button>
                      <n-button size="small" @click="resetHomeCliColumns">恢复默认四列</n-button>
                      <n-button
                        type="primary"
                        size="small"
                        :loading="savingHomeCli"
                        :disabled="!homeCliDirty"
                        @click="saveHomeCliSettings"
                      >
                        保存首页显示
                      </n-button>
                    </div>
                  </div>
                </div>

                <n-divider />

                <!-- 主题设置 -->
                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>界面主题</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      选择你喜欢的界面主题风格
                    </n-text>
                  </div>

                  <div class="simple-theme-options">
                    <!-- 亮色模式 -->
                    <div
                      class="simple-theme-item"
                      :class="{ active: !isDark }"
                      @click="isDark && toggleTheme()"
                    >
                      <n-icon :size="20" class="theme-icon">
                        <SunnyOutline />
                      </n-icon>
                      <div class="theme-text">
                        <n-text strong>亮色模式</n-text>
                        <n-text depth="3" style="font-size: 12px;">经典的浅色主题</n-text>
                      </div>
                      <div v-if="!isDark" class="theme-check">
                        <n-icon :size="20" color="#18a058">
                          <CheckmarkCircleOutline />
                        </n-icon>
                      </div>
                    </div>

                    <!-- 暗色模式 -->
                    <div
                      class="simple-theme-item"
                      :class="{ active: isDark }"
                      @click="!isDark && toggleTheme()"
                    >
                      <n-icon :size="20" class="theme-icon">
                        <MoonOutline />
                      </n-icon>
                      <div class="theme-text">
                        <n-text strong>暗色模式</n-text>
                        <n-text depth="3" style="font-size: 12px;">护眼的深色主题</n-text>
                      </div>
                      <div v-if="isDark" class="theme-check">
                        <n-icon :size="20" color="#18a058">
                          <CheckmarkCircleOutline />
                        </n-icon>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 通知设置面板 -->
          <div v-show="activeMenu === 'notification'" class="settings-panel">
            <div class="panel-header">
              <div class="panel-title-row">
                <n-icon size="24" color="var(--text-secondary)">
                  <NotificationsOutline />
                </n-icon>
                <div>
                  <h3 class="panel-title">通知设置</h3>
                  <n-text depth="3" class="panel-subtitle">配置任务完成时的系统通知</n-text>
                </div>
              </div>
            </div>
            <div class="panel-body">
              <div class="setting-group">
                <template
                  v-for="(platform, index) in notificationHookPlatforms"
                  :key="platform.key"
                >
                  <div class="setting-item">
                    <div class="setting-label">
                      <n-text strong>{{ platform.label }}</n-text>
                      <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                        {{ platform.description }}
                      </n-text>
                    </div>

                    <div class="notification-options">
                      <div class="visibility-item">
                        <div class="visibility-info">
                          <n-text strong>启用任务完成通知</n-text>
                          <n-text depth="3" style="font-size: 13px;">
                            {{ platform.implementation }}
                          </n-text>
                        </div>
                        <n-switch
                          v-model:value="notificationSettings[platform.key].enabled"
                        />
                      </div>

                      <n-alert
                        v-if="notificationSettings[platform.key].external"
                        type="warning"
                        :bordered="false"
                        style="margin-top: 16px;"
                      >
                        {{ platform.externalMessage }}
                      </n-alert>

                        <div v-if="notificationSettings[platform.key].enabled" class="notification-type-section">
                          <n-text depth="2" style="font-size: 13px; margin-bottom: 12px; display: block;">
                            选择通知方式
                          </n-text>
                          <n-radio-group v-model:value="notificationSettings[platform.key].type">
                            <n-space vertical>
                              <n-radio value="notification">
                                <div class="radio-content">
                                  <n-text strong>{{ getNotificationModeTitle('notification') }}</n-text>
                                  <n-text depth="3" style="font-size: 12px; display: block;">
                                    {{ getNotificationModeDescription('notification') }}
                                  </n-text>
                                </div>
                              </n-radio>
                              <n-radio value="browser" :disabled="!browserNotificationAvailable">
                                <div class="radio-content">
                                  <n-text strong>{{ getNotificationModeTitle('browser') }}</n-text>
                                  <n-text depth="3" style="font-size: 12px; display: block;">
                                    {{ getNotificationModeDescription('browser') }}
                                  </n-text>
                                </div>
                              </n-radio>
                              <n-radio value="dialog">
                                <div class="radio-content">
                                  <n-text strong>{{ getNotificationModeTitle('dialog') }}</n-text>
                                  <n-text depth="3" style="font-size: 12px; display: block;">
                                    {{ getNotificationModeDescription('dialog') }}
                                  </n-text>
                                </div>
                              </n-radio>
                            </n-space>
                          </n-radio-group>

                          <n-alert
                            v-if="platform.key === 'claude' && notificationPlatform === 'darwin'"
                            type="info"
                            :bordered="false"
                            style="margin-top: 16px;"
                            :show-icon="false"
                          >
                            <div style="font-size: 13px;">
                              <n-text strong>[TIP] 更好的通知体验</n-text>
                              <n-text depth="3" style="display: block; margin-top: 4px; font-size: 12px;">
                                安装 terminal-notifier 后，点击通知可自动打开终端
                              </n-text>
                              <n-text code style="display: block; margin-top: 8px; font-size: 12px;">
                                brew install terminal-notifier
                              </n-text>
                            </div>
                          </n-alert>
                          <n-alert
                            v-if="notificationSettings[platform.key].type === 'browser'"
                            type="info"
                            :bordered="false"
                            style="margin-top: 16px;"
                          >
                            当前权限状态：{{ browserNotificationPermissionText }}
                          </n-alert>
                      </div>
                    </div>
                  </div>

                  <n-divider v-if="index < notificationHookPlatforms.length - 1" />
                </template>

                <n-divider />

                <!-- 远程通知渠道 -->
                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>远程通知渠道</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      支持微信、QQ、飞书、企业微信、钉钉、Telegram
                    </n-text>
                  </div>

                  <div class="notification-options">
                    <div class="remote-provider-toolbar">
                      <n-select
                        v-model:value="newRemoteProviderType"
                        :options="remoteProviderOptions"
                        size="small"
                        style="max-width: 220px;"
                      />
                      <n-button size="small" secondary type="primary" @click="addRemoteProvider">
                        <template #icon>
                          <n-icon><AddOutline /></n-icon>
                        </template>
                        添加渠道
                      </n-button>
                    </div>

                    <n-empty
                      v-if="notificationSettings.remoteNotifications.providers.length === 0"
                      description="还没有远程通知渠道"
                      style="padding: 20px 0;"
                    />

                    <div
                      v-for="provider in notificationSettings.remoteNotifications.providers"
                      :key="provider.id"
                      class="remote-provider-card"
                    >
                      <div class="remote-provider-header">
                        <div class="remote-provider-title-row">
                          <div class="remote-provider-avatar">
                            {{ getRemoteProviderInitial(provider.type) }}
                          </div>
                          <div class="remote-provider-title">
                            <div class="remote-provider-name-row">
                              <n-text strong>{{ provider.name || getRemoteProviderLabel(provider.type) }}</n-text>
                              <n-tag
                                size="tiny"
                                :bordered="false"
                                :type="provider.enabled ? 'success' : 'default'"
                              >
                                {{ provider.enabled ? '已启用' : '未启用' }}
                              </n-tag>
                            </div>
                            <n-text depth="3" style="font-size: 12px; display: block;">
                              {{ getRemoteProviderDescription(provider.type) }}
                            </n-text>
                          </div>
                        </div>
                        <n-space size="small" align="center">
                          <n-switch v-model:value="provider.enabled" size="small" />
                          <n-button size="small" quaternary circle type="error" @click="removeRemoteProvider(provider.id)">
                            <template #icon>
                              <n-icon><TrashOutline /></n-icon>
                            </template>
                          </n-button>
                        </n-space>
                      </div>

                      <div class="remote-provider-fields">
                        <div class="remote-field">
                          <span class="remote-field-label">渠道名称</span>
                          <n-input
                            v-model:value="provider.name"
                            size="small"
                            placeholder="例如：我的飞书"
                          />
                        </div>

                        <template v-if="provider.type === 'wechatBot'">
                          <div class="remote-field remote-field-wide">
                            <span class="remote-field-label">token.json 路径</span>
                            <n-input v-model:value="provider.config.tokenFile" size="small" placeholder="~/.wxbot/token.json" />
                          </div>
                          <div class="remote-field">
                            <span class="remote-field-label">Token</span>
                            <n-input v-model:value="provider.config.botToken" size="small" type="password" show-password-on="click" placeholder="可直接填写 token" />
                          </div>
                          <div class="remote-field">
                            <span class="remote-field-label">接收用户 ID</span>
                            <n-input v-model:value="provider.config.targetUserId" size="small" placeholder="user id" />
                          </div>
                          <div class="remote-field">
                            <span class="remote-field-label">Context Token</span>
                            <n-input v-model:value="provider.config.contextToken" size="small" placeholder="可选" />
                          </div>
                        </template>

                        <template v-else-if="provider.type === 'qqBot'">
                          <div class="remote-field remote-field-wide">
                            <span class="remote-field-label">OneBot HTTP 地址</span>
                            <n-input v-model:value="provider.config.endpoint" size="small" placeholder="http://127.0.0.1:3000" />
                          </div>
                          <div class="remote-field">
                            <span class="remote-field-label">Access Token</span>
                            <n-input v-model:value="provider.config.accessToken" size="small" type="password" show-password-on="click" placeholder="可选" />
                          </div>
                          <div class="remote-field">
                            <span class="remote-field-label">接收类型</span>
                            <n-select v-model:value="provider.config.targetType" size="small" :options="qqTargetOptions" />
                          </div>
                          <div class="remote-field">
                            <span class="remote-field-label">用户号或群号</span>
                            <n-input v-model:value="provider.config.targetId" size="small" placeholder="QQ ID" />
                          </div>
                        </template>

                        <template v-else-if="provider.type === 'feishuBot'">
                          <div class="remote-field remote-field-wide">
                            <span class="remote-field-label">Webhook URL</span>
                            <n-input v-model:value="provider.config.webhookUrl" size="small" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
                          </div>
                        </template>

                        <template v-else-if="provider.type === 'wecomBot'">
                          <div class="remote-field remote-field-wide">
                            <span class="remote-field-label">Webhook URL</span>
                            <n-input v-model:value="provider.config.webhookUrl" size="small" placeholder="企业微信群机器人 Webhook URL" />
                          </div>
                        </template>

                        <template v-else-if="provider.type === 'dingtalkBot'">
                          <div class="remote-field">
                            <span class="remote-field-label">接入模式</span>
                            <n-select v-model:value="provider.config.mode" size="small" :options="dingtalkModeOptions" />
                          </div>
                          <template v-if="provider.config.mode === 'app'">
                            <div class="remote-field">
                              <span class="remote-field-label">App Key</span>
                              <n-input v-model:value="provider.config.clientId" size="small" placeholder="Client ID" />
                            </div>
                            <div class="remote-field">
                              <span class="remote-field-label">App Secret</span>
                              <n-input v-model:value="provider.config.clientSecret" size="small" type="password" show-password-on="click" placeholder="Secret" />
                            </div>
                            <div class="remote-field">
                              <span class="remote-field-label">接收类型</span>
                              <n-select v-model:value="provider.config.targetType" size="small" :options="dingtalkTargetOptions" />
                            </div>
                            <div class="remote-field">
                              <span class="remote-field-label">接收对象 ID</span>
                              <n-input v-model:value="provider.config.targetId" size="small" placeholder="用户 ID 或群会话 ID" />
                            </div>
                          </template>
                          <div v-else class="remote-field remote-field-wide">
                            <span class="remote-field-label">Webhook URL</span>
                            <n-input v-model:value="provider.config.webhookUrl" size="small" placeholder="钉钉自定义机器人 Webhook URL" />
                          </div>
                        </template>

                        <template v-else-if="provider.type === 'telegramBot'">
                          <div class="remote-field">
                            <span class="remote-field-label">Token</span>
                            <n-input v-model:value="provider.config.botToken" size="small" type="password" show-password-on="click" placeholder="Telegram token" />
                          </div>
                          <div class="remote-field">
                            <span class="remote-field-label">Chat ID</span>
                            <n-input v-model:value="provider.config.chatId" size="small" placeholder="Chat ID" />
                          </div>
                          <div class="remote-field remote-field-wide">
                            <span class="remote-field-label">Proxy</span>
                            <n-input v-model:value="provider.config.proxy" size="small" placeholder="可选，例如 http://127.0.0.1:2082" />
                          </div>
                        </template>
                      </div>

                      <div class="remote-provider-actions">
                        <n-button
                          size="small"
                          secondary
                          :loading="testingRemoteProviderId === provider.id"
                          @click="testRemoteProvider(provider)"
                        >
                          测试
                        </n-button>
                        <n-text depth="3" style="font-size: 12px;">
                          {{ getRemoteProviderHint(provider.type) }}
                        </n-text>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="panel-footer">
              <n-space justify="end">
                <n-button
                  size="large"
                  @click="show = false"
                >
                  取消
                </n-button>
                <n-button
                  type="primary"
                  size="large"
                  :loading="savingNotification"
                  :disabled="JSON.stringify(notificationSettings) === JSON.stringify(originalNotificationSettings)"
                  @click="handleSaveNotification"
                >
                  <template #icon>
                    <n-icon><SaveOutline /></n-icon>
                  </template>
                  保存设置
                </n-button>
              </n-space>
            </div>
          </div>

          <div v-show="activeMenu === 'advanced'" class="settings-panel">
            <div class="panel-header">
              <div class="panel-title-row">
                <n-icon size="24" color="var(--text-secondary)">
                  <OptionsOutline />
                </n-icon>
                <div>
                  <h3 class="panel-title">高级设置</h3>
                  <n-text depth="3" class="panel-subtitle">端口配置和高级选项</n-text>
                </div>
              </div>
            </div>
            <div class="panel-body">
              <div class="setting-group">
                <!-- 端口配置 -->
                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>端口配置</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      修改后需要重启服务器才能生效
                    </n-text>
                  </div>

                  <div class="ports-grid">
                    <!-- Web UI 端口 -->
                    <div class="port-field">
                      <n-text depth="3" style="font-size: 13px; margin-bottom: 6px;">Web UI 端口</n-text>
                      <n-input-number
                        v-model:value="ports.webUI"
                        :min="1024"
                        :max="65535"
                        :show-button="false"
                        placeholder="19999"
                      >
                        <template #prefix>
                          <n-icon><CheckmarkCircleOutline /></n-icon>
                        </template>
                      </n-input-number>
                    </div>

                    <!-- Claude 代理端口 -->
                    <div class="port-field">
                      <n-text depth="3" style="font-size: 13px; margin-bottom: 6px;">Claude 代理</n-text>
                      <n-input-number
                        v-model:value="ports.proxy"
                        :min="1024"
                        :max="65535"
                        :show-button="false"
                        placeholder="20088"
                      >
                        <template #prefix>
                          <n-icon><OptionsOutline /></n-icon>
                        </template>
                      </n-input-number>
                    </div>

                    <!-- Codex 代理端口 -->
                    <div class="port-field">
                      <n-text depth="3" style="font-size: 13px; margin-bottom: 6px;">Codex 代理</n-text>
                      <n-input-number
                        v-model:value="ports.codexProxy"
                        :min="1024"
                        :max="65535"
                        :show-button="false"
                        placeholder="20089"
                      >
                        <template #prefix>
                          <n-icon><OptionsOutline /></n-icon>
                        </template>
                      </n-input-number>
                    </div>

                    <!-- Gemini 代理端口 -->
                    <div class="port-field">
                      <n-text depth="3" style="font-size: 13px; margin-bottom: 6px;">Gemini 代理</n-text>
                      <n-input-number
                        v-model:value="ports.geminiProxy"
                        :min="1024"
                        :max="65535"
                        :show-button="false"
                        placeholder="20090"
                      >
                        <template #prefix>
                          <n-icon><OptionsOutline /></n-icon>
                        </template>
                      </n-input-number>
                    </div>

                    <!-- OpenCode 代理端口 -->
                    <div class="port-field">
                      <n-text depth="3" style="font-size: 13px; margin-bottom: 6px;">OpenCode 代理</n-text>
                      <n-input-number
                        v-model:value="ports.opencodeProxy"
                        :min="1024"
                        :max="65535"
                        :show-button="false"
                        placeholder="20091"
                      >
                        <template #prefix>
                          <n-icon><OptionsOutline /></n-icon>
                        </template>
                      </n-input-number>
                    </div>

                    <div class="port-field">
                      <n-text depth="3" style="font-size: 13px; margin-bottom: 6px;">Pi Agent 托管端口</n-text>
                      <n-input-number
                        v-model:value="ports.piProxy"
                        :min="1024"
                        :max="65535"
                        :show-button="false"
                        placeholder="20092"
                      >
                        <template #prefix>
                          <n-icon><OptionsOutline /></n-icon>
                        </template>
                      </n-input-number>
                    </div>
                  </div>
                </div>

                <n-divider />

                <!-- 负载均衡设置 -->
                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>负载均衡</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      多渠道负载均衡时的分配策略
                    </n-text>
                  </div>

                  <div class="advanced-options">
                    <!-- 会话绑定开关 -->
                    <div class="option-field">
                      <div class="option-label">
                        <n-text depth="2" style="font-size: 13px;">多渠道负载会话绑定</n-text>
                        <n-text depth="3" style="font-size: 12px;">开启后同一对话始终使用同一渠道，保证上下文连续性</n-text>
                      </div>
                      <n-switch
                        v-model:value="advancedSettings.enableSessionBinding"
                        size="medium"
                        @update:value="handleSessionBindingChange"
                      />
                    </div>
                  </div>
                </div>

                <n-divider />

                <!-- 日志和性能设置 -->
                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>日志和性能</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      控制日志显示和数据刷新行为
                    </n-text>
                  </div>

                  <div class="advanced-options">
                    <!-- 日志保留数量 -->
                    <div class="option-field">
                      <div class="option-label">
                        <n-text depth="2" style="font-size: 13px;">实时日志保留数量</n-text>
                        <n-text depth="3" style="font-size: 12px;">超过此数量将自动清理旧日志</n-text>
                      </div>
                      <n-input-number
                        v-model:value="advancedSettings.maxLogs"
                        :min="50"
                        :max="500"
                        :step="10"
                        style="width: 140px;"
                      >
                        <template #suffix>
                          <n-text depth="3" style="font-size: 12px;">条</n-text>
                        </template>
                      </n-input-number>
                    </div>

                    <!-- 统计刷新间隔 -->
                    <div class="option-field">
                      <div class="option-label">
                        <n-text depth="2" style="font-size: 13px;">统计数据刷新间隔</n-text>
                        <n-text depth="3" style="font-size: 12px;">自动刷新今日统计的时间间隔</n-text>
                      </div>
                      <n-input-number
                        v-model:value="advancedSettings.statsInterval"
                        :min="10"
                        :max="300"
                        :step="5"
                        style="width: 140px;"
                      >
                        <template #suffix>
                          <n-text depth="3" style="font-size: 12px;">秒</n-text>
                        </template>
                      </n-input-number>
                    </div>
                  </div>
                </div>

                <n-divider />

                <!-- 开机自启设置 -->
                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>开机自启</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      启用此选项后，重启电脑时 coding-tool-x 会自动启动
                    </n-text>
                  </div>

                  <div style="margin-top: 16px;">
                    <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px; border-left: 3px solid var(--border-secondary);">
                      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                        <n-text strong style="flex: 1;">{{ autoStartStatus }}</n-text>
                        <n-button
                          v-if="!autoStartEnabled"
                          type="primary"
                          size="small"
                          :loading="autoStartLoading"
                          @click="handleEnableAutoStart"
                        >
                          <template #icon>
                            <n-icon><CheckmarkCircleOutline /></n-icon>
                          </template>
                          启用自启
                        </n-button>
                        <n-button
                          v-else
                          type="warning"
                          size="small"
                          :loading="autoStartLoading"
                          @click="handleDisableAutoStart"
                        >
                          <template #icon>
                            <n-icon><WarningOutline /></n-icon>
                          </template>
                          禁用自启
                        </n-button>
                      </div>
                      <n-text depth="3" style="font-size: 12px;">
                        {{ autoStartHelp }}
                      </n-text>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="panel-footer">
              <n-space justify="end">
                <n-button
                  size="large"
                  @click="show = false"
                >
                  取消
                </n-button>
                <n-button
                  type="primary"
                  size="large"
                  :loading="savingPorts"
                  :disabled="!portsChanged"
                  @click="handleSavePorts"
                >
                  <template #icon>
                    <n-icon><SaveOutline /></n-icon>
                  </template>
                  保存端口配置
                </n-button>
              </n-space>
            </div>
          </div>

          <div v-show="activeMenu === 'security'" class="settings-panel">
            <div class="panel-header">
              <div class="panel-title-row">
                <n-icon size="24" color="var(--text-secondary)">
                  <ShieldCheckmarkOutline />
                </n-icon>
                <div>
                  <h3 class="panel-title">安全设置</h3>
                  <n-text depth="3" class="panel-subtitle">设置访问密码，保护面板访问</n-text>
                </div>
              </div>
            </div>

            <div class="panel-body">
              <div class="setting-group">
                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>访问保护</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      启用后，重新打开面板时需要先输入访问密码
                    </n-text>
                  </div>
                  <div class="security-status">
                    <n-tag v-if="securityStatus.hasPassword" type="success" :bordered="false">
                      已启用
                    </n-tag>
                    <n-tag v-else type="warning" :bordered="false">
                      未启用
                    </n-tag>
                  </div>
                </div>

                <n-divider />

                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>{{ securityStatus.hasPassword ? '修改密码' : '设置密码' }}</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      密码至少 4 位，建议包含数字与字母
                    </n-text>
                    <n-text depth="3" style="font-size: 12px; margin-top: 4px;">
                      忘记密码可在终端执行 <n-text code>ctx security reset</n-text> 关闭密码
                    </n-text>
                  </div>

                  <div class="security-form">
                    <n-input
                      v-if="securityStatus.hasPassword"
                      v-model:value="securityForm.currentPassword"
                      type="password"
                      placeholder="当前密码"
                      show-password-on="click"
                    />
                    <n-input
                      v-model:value="securityForm.newPassword"
                      type="password"
                      placeholder="新密码"
                      show-password-on="click"
                    />
                    <n-input
                      v-model:value="securityForm.confirmPassword"
                      type="password"
                      placeholder="确认新密码"
                      show-password-on="click"
                    />
                    <n-text v-if="securityFormError" depth="3" class="security-error">
                      {{ securityFormError }}
                    </n-text>
                  </div>
                </div>
              </div>
            </div>

            <div class="panel-footer">
              <n-space justify="end">
                <n-button
                  size="large"
                  @click="show = false"
                >
                  取消
                </n-button>
                <n-button
                  type="primary"
                  size="large"
                  :loading="savingSecurity"
                  :disabled="!securityFormReady"
                  @click="handleSaveSecurity"
                >
                  <template #icon>
                    <n-icon><SaveOutline /></n-icon>
                  </template>
                  保存密码
                </n-button>
              </n-space>
            </div>
          </div>

          <!-- 模型设置 -->
          <div v-show="activeMenu === 'model-settings'" class="settings-panel">
            <div class="panel-header">
              <div class="panel-title-row">
                <n-icon size="24" color="var(--text-secondary)">
                  <SparklesOutline />
                </n-icon>
                <div>
                  <h3 class="panel-title">模型设置</h3>
                  <n-text depth="3" class="panel-subtitle">管理默认测速模型、模型上下文窗口和定价信息</n-text>
                </div>
              </div>
            </div>

            <div class="panel-body">
              <n-spin :show="modelMetaLoading">
                <!-- 默认测速模型 -->
                <div class="setting-item" style="margin-bottom: 12px;">
                  <div class="model-meta-section">
                    <n-text strong style="font-size: 12px; display: block; margin-bottom: 8px;">默认测速模型</n-text>
                    <div class="speed-test-defaults">
                      <div
                        v-for="tool in speedTestToolRows"
                        :key="tool.key"
                        class="speed-test-default-row"
                      >
                        <div class="speed-test-default-label">
                          <n-text depth="3" style="font-size: 12px;">{{ tool.label }}</n-text>
                        </div>
                        <n-select
                          v-model:value="defaultSpeedTestModels[tool.key]"
                          :options="speedTestModelOptions[tool.key]"
                          :placeholder="`选择${tool.label}默认测速模型`"
                          :disabled="(speedTestModelOptions[tool.key] || []).length === 0"
                          size="small"
                          filterable
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 搜索 + 筛选 + 新增工具栏 -->
                <div class="model-toolbar">
                  <n-input
                    v-model:value="modelMetaSearch"
                    placeholder="搜索模型 ID..."
                    clearable
                    size="small"
                    style="flex: 1; min-width: 0;"
                  />
                  <n-button size="small" type="primary" @click="openAddModelMetaModal">
                    <template #icon>
                      <n-icon><AddOutline /></n-icon>
                    </template>
                    新增
                  </n-button>
                </div>
                <div class="model-filter-row">
                  <n-radio-group v-model:value="modelMetaFilter" size="small">
                    <n-radio value="all">全部</n-radio>
                    <n-radio value="claude">Claude</n-radio>
                    <n-radio value="openai">OpenAI</n-radio>
                    <n-radio value="gemini">Gemini</n-radio>
                    <n-radio value="overrides">自定义</n-radio>
                  </n-radio-group>
                </div>

                <div v-if="filteredModelMeta.length === 0" class="setting-item">
                  <n-empty description="没有匹配的模型" />
                </div>

                <!-- 模型列表 -->
                <div v-else class="model-list">
                  <div
                    v-for="modelId in filteredModelMeta"
                    :key="modelId"
                    class="model-card"
                    :class="{ expanded: expandedModels.has(modelId) }"
                  >
                    <div class="model-card-header" @click="toggleModelExpand(modelId)">
                      <n-icon size="14" class="expand-icon">
                        <ChevronForwardOutline />
                      </n-icon>
                      <span class="model-card-id">{{ modelId }}</span>
                      <n-tag v-if="modelMetaOverrides[modelId]" type="warning" size="tiny" :bordered="false">自定义</n-tag>
                      <div class="model-card-actions" @click.stop>
                        <n-button
                          v-if="modelMetaOverrides[modelId] && isBuiltInModel(modelId)"
                          size="tiny"
                          quaternary
                          type="warning"
                          @click="handleResetModelMeta(modelId)"
                        >
                          重置
                        </n-button>
                        <n-button
                          v-if="isCustomModel(modelId)"
                          size="tiny"
                          quaternary
                          type="error"
                          @click="handleDeleteModelMeta(modelId)"
                        >
                          删除
                        </n-button>
                      </div>
                    </div>
                    <div v-if="expandedModels.has(modelId)" class="model-card-body">
                      <div class="model-meta-editor">
                        <!-- Context Window -->
                        <div class="model-meta-section">
                          <n-text strong style="font-size: 12px; display: block; margin-bottom: 8px;">上下文限制</n-text>
                          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <div>
                              <n-text depth="3" style="font-size: 11px;">Context 窗口 (tokens)</n-text>
                              <n-input-number
                                :value="getModelMetaField(modelId, 'limit', 'context')"
                                @update:value="v => setModelMetaField(modelId, 'limit', 'context', v)"
                                :min="1000"
                                :step="1000"
                                size="small"
                                :show-button="false"
                                style="width: 100%;"
                              />
                            </div>
                            <div>
                              <n-text depth="3" style="font-size: 11px;">Max Output (tokens)</n-text>
                              <n-input-number
                                :value="getModelMetaField(modelId, 'limit', 'output')"
                                @update:value="v => setModelMetaField(modelId, 'limit', 'output', v)"
                                :min="100"
                                :step="1000"
                                size="small"
                                :show-button="false"
                                style="width: 100%;"
                              />
                            </div>
                          </div>
                        </div>
                        <!-- Pricing -->
                        <div class="model-meta-section" style="margin-top: 8px;">
                          <n-text strong style="font-size: 12px; display: block; margin-bottom: 8px;">定价（USD / 百万 tokens）</n-text>
                          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <div>
                              <n-text depth="3" style="font-size: 11px;">输入价格</n-text>
                              <n-input-number
                                :value="getModelMetaField(modelId, 'pricing', 'input')"
                                @update:value="v => setModelMetaField(modelId, 'pricing', 'input', v)"
                                :min="0"
                                :step="0.1"
                                :precision="4"
                                size="small"
                                :show-button="false"
                                style="width: 100%;"
                              />
                            </div>
                            <div>
                              <n-text depth="3" style="font-size: 11px;">输出价格</n-text>
                              <n-input-number
                                :value="getModelMetaField(modelId, 'pricing', 'output')"
                                @update:value="v => setModelMetaField(modelId, 'pricing', 'output', v)"
                                :min="0"
                                :step="0.1"
                                :precision="4"
                                size="small"
                                :show-button="false"
                                style="width: 100%;"
                              />
                            </div>
                            <div>
                              <n-text depth="3" style="font-size: 11px;">缓存写入价格</n-text>
                              <n-input-number
                                :value="getModelMetaField(modelId, 'pricing', 'cacheCreation')"
                                @update:value="v => setModelMetaField(modelId, 'pricing', 'cacheCreation', v)"
                                :min="0"
                                :step="0.1"
                                :precision="4"
                                size="small"
                                :show-button="false"
                                style="width: 100%;"
                              />
                            </div>
                            <div>
                              <n-text depth="3" style="font-size: 11px;">缓存读取价格</n-text>
                              <n-input-number
                                :value="getModelMetaField(modelId, 'pricing', 'cacheRead')"
                                @update:value="v => setModelMetaField(modelId, 'pricing', 'cacheRead', v)"
                                :min="0"
                                :step="0.01"
                                :precision="4"
                                size="small"
                                :show-button="false"
                                style="width: 100%;"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </n-spin>
            </div>

            <div class="panel-footer">
              <n-space justify="end">
                <n-button size="large" @click="handleResetAllModelMeta" :disabled="Object.keys(modelMetaOverrides).length === 0">
                  重置全部
                </n-button>
                <n-button
                  type="primary"
                  size="large"
                  :loading="savingModelMeta"
                  :disabled="!modelSettingsDirty"
                  @click="handleSaveModelMeta"
                >
                  <template #icon>
                    <n-icon><SaveOutline /></n-icon>
                  </template>
                  保存设置
                </n-button>
              </n-space>
            </div>
          </div>
        </div>
      </div>
      <n-modal
        v-model:show="showAddModelMetaModal"
        preset="card"
        title="新增模型设置"
        style="width: 560px;"
        :mask-closable="false"
      >
        <n-space vertical :size="12">
          <div>
            <n-text depth="3" style="font-size: 12px;">模型 ID</n-text>
            <n-input
              v-model:value="newModelMetaForm.modelId"
              placeholder="例如：gpt-4.1-mini"
              clearable
            />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <n-text depth="3" style="font-size: 12px;">Context 窗口</n-text>
              <n-input-number
                v-model:value="newModelMetaForm.context"
                :min="1000"
                :step="1000"
                :show-button="false"
                style="width: 100%;"
              />
            </div>
            <div>
              <n-text depth="3" style="font-size: 12px;">Max Output</n-text>
              <n-input-number
                v-model:value="newModelMetaForm.output"
                :min="100"
                :step="100"
                :show-button="false"
                style="width: 100%;"
              />
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <n-text depth="3" style="font-size: 12px;">输入价格</n-text>
              <n-input-number
                v-model:value="newModelMetaForm.inputPrice"
                :min="0"
                :step="0.1"
                :precision="4"
                :show-button="false"
                style="width: 100%;"
              />
            </div>
            <div>
              <n-text depth="3" style="font-size: 12px;">输出价格</n-text>
              <n-input-number
                v-model:value="newModelMetaForm.outputPrice"
                :min="0"
                :step="0.1"
                :precision="4"
                :show-button="false"
                style="width: 100%;"
              />
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <n-text depth="3" style="font-size: 12px;">缓存写入价格</n-text>
              <n-input-number
                v-model:value="newModelMetaForm.cacheCreationPrice"
                :min="0"
                :step="0.1"
                :precision="4"
                :show-button="false"
                style="width: 100%;"
              />
            </div>
            <div>
              <n-text depth="3" style="font-size: 12px;">缓存读取价格</n-text>
              <n-input-number
                v-model:value="newModelMetaForm.cacheReadPrice"
                :min="0"
                :step="0.01"
                :precision="4"
                :show-button="false"
                style="width: 100%;"
              />
            </div>
          </div>
          <n-text v-if="newModelMetaError" depth="3" class="security-error">
            {{ newModelMetaError }}
          </n-text>
          <n-space justify="end">
            <n-button @click="closeAddModelMetaModal">取消</n-button>
            <n-button type="primary" :disabled="!!newModelMetaError" @click="handleAddModelMeta">
              新增
            </n-button>
          </n-space>
        </n-space>
      </n-modal>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, computed, watch, onMounted, markRaw } from 'vue'
import {
  NDrawer, NDrawerContent, NSpace, NText, NSelect, NButton, NAlert,
  NIcon, NBadge, NSpin, NDivider, NTag, NEmpty, NSwitch, NInputNumber,
  NRadio, NRadioGroup, NInput, NModal, NCollapse, NCollapseItem, NCard
} from 'naive-ui'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'

const { drawerWidth, isMobile } = useResponsiveDrawer(720)
import {
  SettingsOutline, ColorPaletteOutline, OptionsOutline,
  SaveOutline, CheckmarkCircleOutline, StarOutline, WarningOutline,
  SunnyOutline, MoonOutline, NotificationsOutline,
  SparklesOutline, ShieldCheckmarkOutline, AddOutline, ChevronForwardOutline,
  TrashOutline
} from '@vicons/ionicons5'
import { getUIConfig, saveUIConfig, updateNestedUIConfig } from '../api/ui-config'
import { DEFAULT_HOME_CLI_COLUMNS, buildCliPlatformOptions, normalizeCustomCliPlatforms, normalizeHomeCliColumns } from '../config/platforms'
import { getSecurityStatus, setSecurityPassword } from '../api/security'
import { getAutoStartStatus, enableAutoStart, disableAutoStart } from '../api/pm2'
import message from '../utils/message'
import { useTheme } from '../composables/useTheme'
import { client } from '../api/client'

async function fetchModelSettings() {
  const resp = await client.get('/settings/model-settings')
  return resp.data
}

async function saveModelSettingsPayload(payload) {
  const resp = await client.post('/settings/model-settings', payload)
  return resp.data
}

async function deleteModelMetadataOverride(modelId) {
  const resp = await client.delete(`/settings/model-settings/${encodeURIComponent(modelId)}`)
  return resp.data
}

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:visible'])
const show = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const activeMenu = ref('appearance')

// 主题管理
const { isDark, toggleTheme } = useTheme()

// 面板可见性设置
const showChannels = ref(true)
const showLogs = ref(true)
const showChannelBalance = ref(false)

// 端口配置
const ports = ref({
  webUI: 19999,
  proxy: 20088,
  codexProxy: 20089,
  geminiProxy: 20090,
  opencodeProxy: 20091,
  piProxy: 20092
})
const originalPorts = ref({
  webUI: 19999,
  proxy: 20088,
  codexProxy: 20089,
  geminiProxy: 20090,
  opencodeProxy: 20091,
  piProxy: 20092
})
const savingPorts = ref(false)
const homeCliColumns = ref([...DEFAULT_HOME_CLI_COLUMNS])
const customCliPlatforms = ref([])
const originalHomeCliSettings = ref({
  homeCliColumns: [...DEFAULT_HOME_CLI_COLUMNS],
  customCliPlatforms: []
})
const savingHomeCli = ref(false)

// 开机自启配置
const autoStartEnabled = ref(false)
const autoStartLoading = ref(false)
const autoStartStatus = computed(() => autoStartEnabled.value ? '[v] 已启用' : '未启用')
const autoStartHelp = computed(() => {
  if (autoStartEnabled.value) {
    return '重启电脑时 coding-tool-x 会自动启动。如需禁用，点击下方按钮'
  } else {
    return '启用后，重启电脑时 coding-tool-x 会自动启动'
  }
})

// 高级设置
const advancedSettings = ref({
  maxLogs: 100,
  statsInterval: 30,
  enableSessionBinding: true // 默认开启
})
const originalAdvancedSettings = ref({
  maxLogs: 100,
  statsInterval: 30,
  enableSessionBinding: true
})

// 通知设置
const notificationHookPlatforms = [
  {
    key: 'claude',
    label: 'Claude Code',
    description: '当 Claude Code 任务完成或等待交互时发送系统通知',
    implementation: '通过 Claude Code 的 Stop Hook 在任务完成时发送通知',
    externalMessage: '检测到已有非 Coding Tool 的 Stop Hook。本界面只管理 Coding Tool 写入的通知配置。'
  },
  {
    key: 'codex',
    label: 'Codex CLI',
    description: '当 Codex CLI 当前回合完成并等待下一步交互时发送系统通知',
    implementation: '通过 Codex CLI 的 notify 命令在回合完成后发送通知',
    externalMessage: '检测到现有 notify 配置。启用 Coding Tool 托管通知会替换当前 notify 命令；关闭时只会移除 Coding Tool 写入的 notify。'
  },
  {
    key: 'gemini',
    label: 'Gemini CLI',
    description: '当 Gemini CLI 回合完成或等待下一步交互时发送系统通知',
    implementation: '通过 Gemini CLI 的 AfterAgent Hook 在任务完成时发送通知',
    externalMessage: '检测到已有非 Coding Tool 的 Gemini Hook。本界面只管理 Coding Tool 写入的通知配置。'
  },
  {
    key: 'opencode',
    label: 'OpenCode',
    description: '当 OpenCode 会话空闲或发生错误时发送系统通知',
    implementation: '通过 OpenCode 插件事件（session.idle / session.error）发送通知',
    externalMessage: '检测到其他 OpenCode 通知配置时，本界面只管理 Coding Tool 生成的插件文件。'
  }
]

function createNotificationPlatformState(platform = {}) {
  return {
    enabled: platform.enabled === true,
    type: platform.type === 'dialog' || platform.type === 'browser' ? platform.type : 'notification',
    external: platform.external === true
  }
}

const REMOTE_PROVIDER_DEFINITIONS = {
  wechatBot: {
    label: '微信',
    description: '使用个人微信 iLink token 发送通知',
    hint: '首次 token 可由 GA 微信扫码生成；也可以直接填写 token。'
  },
  qqBot: {
    label: 'QQ',
    description: '通过 OneBot / NapCat / go-cqhttp 兼容 HTTP 接口发送通知',
    hint: 'GA 当前构建已移除 QQ 前端，这里按 OneBot 兼容桥接入。'
  },
  feishuBot: {
    label: '飞书',
    description: '通过飞书自定义机器人 Webhook 发送通知',
    hint: '填写飞书自定义机器人 Webhook URL。'
  },
  wecomBot: {
    label: '企业微信',
    description: '通过企业微信群机器人 Webhook 发送通知',
    hint: '当前通知发送使用企业微信群机器人 Webhook；GA 的 bot_id / secret 长连接模式不适合单向通知。'
  },
  dingtalkBot: {
    label: '钉钉',
    description: '支持钉钉自定义机器人 Webhook 和 GA 同款 App 模式',
    hint: 'App 模式需要 App Key / App Secret，并填写用户 ID 或群会话 ID。'
  },
  telegramBot: {
    label: 'Telegram',
    description: '通过 Telegram Bot API sendMessage 发送通知',
    hint: '需要 Token 和 Chat ID。'
  }
}

const REMOTE_PROVIDER_INITIALS = {
  wechatBot: '微',
  qqBot: 'Q',
  feishuBot: '飞',
  wecomBot: '企',
  dingtalkBot: '钉',
  telegramBot: 'T'
}

const LEGACY_REMOTE_PROVIDER_NAMES = {
  wechatBot: '微信 Bot',
  qqBot: 'QQ Bot',
  feishuBot: '飞书 Bot',
  wecomBot: '企业微信 Bot',
  dingtalkBot: '钉钉 Bot',
  telegramBot: 'Telegram Bot'
}

const remoteProviderOptions = Object.entries(REMOTE_PROVIDER_DEFINITIONS).map(([value, item]) => ({
  label: item.label,
  value
}))
const qqTargetOptions = [
  { label: '私聊', value: 'private' },
  { label: '群聊', value: 'group' }
]
const dingtalkModeOptions = [
  { label: 'Webhook', value: 'webhook' },
  { label: 'GA App 模式', value: 'app' }
]
const dingtalkTargetOptions = [
  { label: '群会话', value: 'group' },
  { label: '用户', value: 'user' }
]

function createRemoteProviderConfig(type) {
  switch (type) {
    case 'wechatBot':
      return { tokenFile: '~/.wxbot/token.json', botToken: '', targetUserId: '', contextToken: '' }
    case 'qqBot':
      return { endpoint: 'http://127.0.0.1:3000', accessToken: '', targetType: 'private', targetId: '' }
    case 'feishuBot':
      return { webhookUrl: '' }
    case 'wecomBot':
      return { webhookUrl: '' }
    case 'dingtalkBot':
      return { mode: 'webhook', webhookUrl: '', clientId: '', clientSecret: '', targetType: 'group', targetId: '' }
    case 'telegramBot':
      return { botToken: '', chatId: '', proxy: '' }
    default:
      return {}
  }
}

function createRemoteProvider(type = 'telegramBot') {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    name: getRemoteProviderLabel(type),
    enabled: false,
    config: createRemoteProviderConfig(type)
  }
}

function normalizeRemoteProvider(provider = {}) {
  const type = REMOTE_PROVIDER_DEFINITIONS[provider.type] ? provider.type : 'telegramBot'
  const legacyName = LEGACY_REMOTE_PROVIDER_NAMES[type]
  const name = provider.name && provider.name !== legacyName ? provider.name : getRemoteProviderLabel(type)
  return {
    id: provider.id || `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    name,
    enabled: provider.enabled === true,
    config: {
      ...createRemoteProviderConfig(type),
      ...(provider.config || {})
    }
  }
}

function getRemoteProviderLabel(type) {
  return REMOTE_PROVIDER_DEFINITIONS[type]?.label || '远程通知'
}

function getRemoteProviderDescription(type) {
  return REMOTE_PROVIDER_DEFINITIONS[type]?.description || ''
}

function getRemoteProviderHint(type) {
  return REMOTE_PROVIDER_DEFINITIONS[type]?.hint || ''
}

function getRemoteProviderInitial(type) {
  return REMOTE_PROVIDER_INITIALS[type] || '通'
}

function createNotificationSettingsState(data = {}) {
  const legacyClaudeState = {
    enabled: data?.stopHook?.enabled,
    type: data?.stopHook?.type
  }
  const providers = Array.isArray(data?.remoteNotifications?.providers)
    ? data.remoteNotifications.providers.map(normalizeRemoteProvider)
    : []

  return {
    claude: createNotificationPlatformState(data?.platforms?.claude || legacyClaudeState),
    codex: createNotificationPlatformState(data?.platforms?.codex),
    gemini: createNotificationPlatformState(data?.platforms?.gemini),
    opencode: createNotificationPlatformState(data?.platforms?.opencode),
    remoteNotifications: {
      providers
    }
  }
}

const notificationSettings = ref(createNotificationSettingsState())
const originalNotificationSettings = ref(createNotificationSettingsState())
const savingNotification = ref(false)
const testingRemoteProviderId = ref('')
const newRemoteProviderType = ref('telegramBot')
const notificationPlatform = ref('')  // 'darwin' | 'win32' | 'linux'
const browserNotificationPermission = ref('default')
const browserNotificationAvailable = computed(() => {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return false
  }
  if (window.isSecureContext) {
    return true
  }
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
})

const browserNotificationPermissionText = computed(() => {
  if (!browserNotificationAvailable.value) {
    return '当前环境不支持浏览器通知，请使用 localhost 或 HTTPS 页面'
  }
  if (browserNotificationPermission.value === 'granted') {
    return '已授权'
  }
  if (browserNotificationPermission.value === 'denied') {
    return '已被浏览器拒绝，请在浏览器站点设置里重新开启'
  }
  return '尚未授权，保存时会请求浏览器权限'
})

function getNotificationModeTitle(type = 'notification') {
  if (type === 'browser') {
    return '浏览器通知'
  }
  if (type === 'dialog') {
    return '确认式弹窗'
  }

  switch (notificationPlatform.value) {
    case 'win32':
      return '右上角悬浮卡片'
    case 'darwin':
      return '角落横幅通知'
    case 'linux':
      return '桌面环境通知'
    default:
      return '轻提醒卡片'
  }
}

function getNotificationModeDescription(type = 'notification') {
  if (type === 'browser') {
    if (!browserNotificationAvailable.value) {
      return '当前页面环境不支持浏览器通知'
    }
    if (browserNotificationPermission.value === 'granted') {
      return '通过当前打开的 Web 页面显示浏览器原生通知'
    }
    if (browserNotificationPermission.value === 'denied') {
      return '浏览器通知权限已被拒绝，需要先在浏览器中重新授权'
    }
    return '通过当前打开的 Web 页面显示原生通知，保存时会请求权限'
  }
  if (type === 'dialog') {
    return '强制提醒，需要手动点击确认才能关闭'
  }

  switch (notificationPlatform.value) {
    case 'win32':
      return '轻量提醒，几秒后自动消失，带提示音（Windows 使用系统 Toast 风格提醒）'
    default:
      return '轻量提醒，几秒后自动消失，带提示音'
  }
}

function refreshBrowserNotificationPermission() {
  if (typeof Notification === 'undefined') {
    browserNotificationPermission.value = 'unsupported'
    return
  }
  browserNotificationPermission.value = Notification.permission
}

async function ensureBrowserNotificationPermission() {
  if (!browserNotificationAvailable.value) {
    throw new Error('当前页面环境不支持浏览器通知，请改用 HTTPS 或 localhost 页面')
  }

  refreshBrowserNotificationPermission()
  if (browserNotificationPermission.value === 'granted') {
    return
  }

  const permission = await Notification.requestPermission()
  browserNotificationPermission.value = permission
  if (permission !== 'granted') {
    throw new Error('浏览器通知权限未授予')
  }
}

function addRemoteProvider() {
  notificationSettings.value.remoteNotifications.providers.push(createRemoteProvider(newRemoteProviderType.value))
}

function removeRemoteProvider(providerId) {
  notificationSettings.value.remoteNotifications.providers =
    notificationSettings.value.remoteNotifications.providers.filter(provider => provider.id !== providerId)
}

async function testRemoteProvider(provider) {
  testingRemoteProviderId.value = provider.id
  try {
    const response = await fetch('/api/hooks/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || '测试通知发送失败')
    }
    message.success(data.message || '测试通知已发送')
  } catch (error) {
    message.error('测试失败：' + error.message)
  } finally {
    testingRemoteProviderId.value = ''
  }
}

// 安全设置
const securityStatus = ref({
  hasPassword: false
})
const securityStatusLoaded = ref(false)
const securityStatusLoading = ref(false)
const securityForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const savingSecurity = ref(false)
let securityStatusPromise = null

// ─── 模型设置管理 ──────────────────────────────────────────────────────────
const modelMetaLoading = ref(false)
const savingModelMeta = ref(false)
// Built-in + overrides merged table, keyed by model ID
const modelMetaTable = ref({})
// User overrides only (what's saved to config)
const modelMetaOverrides = ref({})
// Local edits: { [modelId]: { limit?: {...}, pricing?: {...} } }
const modelMetaEdits = ref({})
const modelMetaSearch = ref('')
const modelMetaFilter = ref('all')
const showAddModelMetaModal = ref(false)
const newModelMetaForm = ref(createDefaultNewModelMeta())
const builtInModelIds = ref(new Set())
const defaultSpeedTestModels = ref({
  claude: '',
  codex: '',
  gemini: ''
})
const originalDefaultSpeedTestModels = ref({
  claude: '',
  codex: '',
  gemini: ''
})
const speedTestToolRows = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'Codex' },
  { key: 'gemini', label: 'Gemini CLI' }
]

const expandedModels = ref(new Set())
const toggleModelExpand = (modelId) => {
  if (expandedModels.value.has(modelId)) {
    expandedModels.value.delete(modelId)
  } else {
    expandedModels.value.add(modelId)
  }
  // trigger reactivity
  expandedModels.value = new Set(expandedModels.value)
}

const modelMetaDirty = computed(() => Object.keys(modelMetaEdits.value).length > 0)
const modelSettingsDirty = computed(() => {
  return modelMetaDirty.value || JSON.stringify(defaultSpeedTestModels.value) !== JSON.stringify(originalDefaultSpeedTestModels.value)
})
const newModelMetaError = computed(() => {
  const modelId = String(newModelMetaForm.value.modelId || '').trim()
  if (!modelId) return '请输入模型 ID'
  const duplicate = Object.keys(modelMetaTable.value).find(id => id.toLowerCase() === modelId.toLowerCase())
  if (duplicate) return `模型已存在：${duplicate}`
  if (!Number.isFinite(newModelMetaForm.value.context) || newModelMetaForm.value.context <= 0) return 'Context 窗口必须为正数'
  if (!Number.isFinite(newModelMetaForm.value.output) || newModelMetaForm.value.output <= 0) return 'Max Output 必须为正数'
  if (newModelMetaForm.value.inputPrice < 0 || newModelMetaForm.value.outputPrice < 0 || newModelMetaForm.value.cacheCreationPrice < 0 || newModelMetaForm.value.cacheReadPrice < 0) {
    return '价格不能为负数'
  }
  return ''
})

function createDefaultNewModelMeta() {
  return {
    modelId: '',
    context: 128000,
    output: 8192,
    inputPrice: 0,
    outputPrice: 0,
    cacheCreationPrice: 0,
    cacheReadPrice: 0
  }
}

function openAddModelMetaModal() {
  newModelMetaForm.value = createDefaultNewModelMeta()
  showAddModelMetaModal.value = true
}

function closeAddModelMetaModal() {
  showAddModelMetaModal.value = false
}

function handleAddModelMeta() {
  if (newModelMetaError.value) return

  const modelId = String(newModelMetaForm.value.modelId || '').trim()
  const meta = {
    limit: {
      context: newModelMetaForm.value.context,
      output: newModelMetaForm.value.output
    },
    pricing: {
      input: newModelMetaForm.value.inputPrice,
      output: newModelMetaForm.value.outputPrice,
      cacheCreation: newModelMetaForm.value.cacheCreationPrice,
      cacheRead: newModelMetaForm.value.cacheReadPrice
    }
  }

  modelMetaTable.value[modelId] = meta
  modelMetaEdits.value[modelId] = {
    limit: { ...meta.limit },
    pricing: { ...meta.pricing }
  }
  modelMetaSearch.value = modelId
  showAddModelMetaModal.value = false
  message.success('模型已新增，请点击“保存设置”使其生效')
}

function isBuiltInModel(modelId) {
  return builtInModelIds.value.has(modelId)
}

function isCustomModel(modelId) {
  return !isBuiltInModel(modelId)
}

const filteredModelMeta = computed(() => {
  const allIds = Object.keys(modelMetaTable.value)
  const search = modelMetaSearch.value.trim().toLowerCase()
  const filter = modelMetaFilter.value

  return allIds.filter(id => {
    if (search && !id.toLowerCase().includes(search)) return false
    if (filter === 'claude') return id.startsWith('claude-')
    if (filter === 'openai') return id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')
    if (filter === 'gemini') return id.startsWith('gemini-')
    if (filter === 'overrides') return !!modelMetaOverrides.value[id]
    return true
  })
})

function getModelProviderById(modelId) {
  const id = String(modelId || '').trim().toLowerCase()
  if (id.startsWith('claude-')) return 'claude'
  if (id.startsWith('gemini-')) return 'gemini'
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) return 'codex'
  return ''
}

const speedTestModelOptions = computed(() => {
  const grouped = {
    claude: [],
    codex: [],
    gemini: []
  }

  for (const [modelId, meta] of Object.entries(modelMetaTable.value || {})) {
    if (!meta || typeof meta !== 'object' || !meta.limit || !meta.pricing) continue
    const provider = getModelProviderById(modelId)
    if (!provider || !grouped[provider]) continue
    grouped[provider].push({
      label: modelId,
      value: modelId
    })
  }

  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => a.label.localeCompare(b.label))
  }

  return grouped
})

function normalizeDefaultSpeedTestModelSelection() {
  const next = { ...defaultSpeedTestModels.value }
  let changed = false

  for (const tool of speedTestToolRows) {
    const options = speedTestModelOptions.value[tool.key] || []
    if (options.length === 0) continue
    const optionValues = new Set(options.map(item => item.value))
    if (!optionValues.has(next[tool.key])) {
      next[tool.key] = options[0].value
      changed = true
    }
  }

  if (changed) {
    defaultSpeedTestModels.value = next
  }
}

function getModelMetaField(modelId, section, field) {
  // Local edit takes priority
  if (modelMetaEdits.value[modelId]?.[section]?.[field] !== undefined) {
    return modelMetaEdits.value[modelId][section][field]
  }
  // Then from merged table
  return modelMetaTable.value[modelId]?.[section]?.[field] ?? null
}

function setModelMetaField(modelId, section, field, value) {
  if (!modelMetaEdits.value[modelId]) {
    // Start from the current merged values
    const current = modelMetaTable.value[modelId] || {}
    modelMetaEdits.value[modelId] = {
      limit: { ...(current.limit || {}) },
      pricing: { ...(current.pricing || {}) }
    }
  }
  if (!modelMetaEdits.value[modelId][section]) {
    modelMetaEdits.value[modelId][section] = {}
  }
  modelMetaEdits.value[modelId][section][field] = value
}

async function loadModelMetadata() {
  modelMetaLoading.value = true
  try {
    const data = await fetchModelSettings()
    modelMetaTable.value = data.models || {}
    modelMetaOverrides.value = data.overrides || {}
    builtInModelIds.value = new Set(data.builtinModelIds || [])
    defaultSpeedTestModels.value = {
      claude: typeof data.defaultSpeedTestModels?.claude === 'string' ? data.defaultSpeedTestModels.claude : '',
      codex: typeof data.defaultSpeedTestModels?.codex === 'string' ? data.defaultSpeedTestModels.codex : '',
      gemini: typeof data.defaultSpeedTestModels?.gemini === 'string' ? data.defaultSpeedTestModels.gemini : ''
    }
    normalizeDefaultSpeedTestModelSelection()
    originalDefaultSpeedTestModels.value = { ...defaultSpeedTestModels.value }
    modelMetaEdits.value = {}
  } catch (err) {
    console.error('Failed to load model metadata:', err)
  } finally {
    modelMetaLoading.value = false
  }
}

async function handleSaveModelMeta() {
  savingModelMeta.value = true
  try {
    // Merge edits into existing overrides
    const newOverrides = { ...modelMetaOverrides.value }
    for (const [modelId, edits] of Object.entries(modelMetaEdits.value)) {
      const existing = newOverrides[modelId] || {}
      newOverrides[modelId] = {
        limit: { ...(existing.limit || {}), ...(edits.limit || {}) },
        pricing: { ...(existing.pricing || {}), ...(edits.pricing || {}) }
      }
    }
    await saveModelSettingsPayload({
      overrides: newOverrides,
      defaultSpeedTestModels: defaultSpeedTestModels.value
    })
    modelMetaOverrides.value = newOverrides
    originalDefaultSpeedTestModels.value = { ...defaultSpeedTestModels.value }
    modelMetaEdits.value = {}
    // Refresh merged table
    await loadModelMetadata()
    message.success('模型设置已保存')
  } catch (err) {
    console.error('Failed to save model metadata:', err)
    message.error('保存失败：' + err.message)
  } finally {
    savingModelMeta.value = false
  }
}

async function handleResetModelMeta(modelId) {
  try {
    await deleteModelMetadataOverride(modelId)
    delete modelMetaOverrides.value[modelId]
    delete modelMetaEdits.value[modelId]
    await loadModelMetadata()
    message.success(`${modelId} 已重置为内置默认值`)
  } catch (err) {
    message.error('重置失败：' + err.message)
  }
}

async function handleResetAllModelMeta() {
  try {
    await saveModelSettingsPayload({
      overrides: {},
      defaultSpeedTestModels: defaultSpeedTestModels.value
    })
    modelMetaOverrides.value = {}
    modelMetaEdits.value = {}
    await loadModelMetadata()
    message.success('全部模型设置已重置为内置默认值')
  } catch (err) {
    message.error('重置失败：' + err.message)
  }
}

async function handleDeleteModelMeta(modelId) {
  try {
    const hasOverride = !!modelMetaOverrides.value[modelId]
    if (hasOverride) {
      await deleteModelMetadataOverride(modelId)
      delete modelMetaOverrides.value[modelId]
    }

    delete modelMetaEdits.value[modelId]
    if (isCustomModel(modelId)) {
      delete modelMetaTable.value[modelId]
    } else if (hasOverride) {
      await loadModelMetadata()
    }

    message.success(`已删除模型：${modelId}`)
  } catch (err) {
    message.error('删除失败：' + err.message)
  }
}

// 检查配置是否有修改
const portsChanged = computed(() => {
  return ports.value.webUI !== originalPorts.value.webUI ||
    ports.value.proxy !== originalPorts.value.proxy ||
    ports.value.codexProxy !== originalPorts.value.codexProxy ||
    ports.value.geminiProxy !== originalPorts.value.geminiProxy ||
    ports.value.opencodeProxy !== originalPorts.value.opencodeProxy ||
    ports.value.piProxy !== originalPorts.value.piProxy ||
    advancedSettings.value.maxLogs !== originalAdvancedSettings.value.maxLogs ||
    advancedSettings.value.statsInterval !== originalAdvancedSettings.value.statsInterval ||
    advancedSettings.value.enableSessionBinding !== originalAdvancedSettings.value.enableSessionBinding
})

const homeCliOptions = computed(() => buildCliPlatformOptions(customCliPlatforms.value))

const homeCliDirty = computed(() => {
  return JSON.stringify(homeCliColumns.value) !== JSON.stringify(originalHomeCliSettings.value.homeCliColumns) ||
    JSON.stringify(normalizeCustomCliPlatforms(customCliPlatforms.value)) !== JSON.stringify(originalHomeCliSettings.value.customCliPlatforms)
})

const securityFormError = computed(() => {
  if (!securityForm.value.newPassword || !securityForm.value.confirmPassword) {
    return ''
  }
  if (securityForm.value.newPassword.length < 4) {
    return '密码至少 4 位'
  }
  if (securityForm.value.newPassword !== securityForm.value.confirmPassword) {
    return '两次输入的新密码不一致'
  }
  return ''
})

const securityFormReady = computed(() => {
  if (!securityForm.value.newPassword || !securityForm.value.confirmPassword) {
    return false
  }
  if (securityFormError.value) {
    return false
  }
  if (securityStatus.value.hasPassword && !securityForm.value.currentPassword) {
    return false
  }
  return true
})

// 菜单项配置
const menuItems = computed(() => [
  {
    key: 'appearance',
    label: '外观设置',
    icon: markRaw(ColorPaletteOutline)
  },
  {
    key: 'notification',
    label: '通知设置',
    icon: markRaw(NotificationsOutline)
  },
  {
    key: 'advanced',
    label: '高级设置',
    icon: markRaw(OptionsOutline)
  },
  {
    key: 'security',
    label: '安全设置',
    icon: markRaw(ShieldCheckmarkOutline)
  },
  {
    key: 'model-settings',
    label: '模型设置',
    icon: markRaw(SparklesOutline)
  }
])

// 加载面板可见性设置
async function loadPanelSettings() {
  try {
    const response = await getUIConfig()
    if (response.success && response.config) {
      showChannels.value = response.config.panelVisibility?.showChannels !== false // default true
      showLogs.value = response.config.panelVisibility?.showLogs !== false // default true
      showChannelBalance.value = response.config.channelBalance?.showRemaining === true
      const normalizedCustom = normalizeCustomCliPlatforms(response.config.customCliPlatforms || [])
      const normalizedColumns = normalizeHomeCliColumns(
        response.config.homeCliColumns || response.config.dashboardChannelOrder,
        normalizedCustom
      )
      customCliPlatforms.value = normalizedCustom.map(platform => ({ ...platform }))
      homeCliColumns.value = normalizedColumns
      originalHomeCliSettings.value = {
        homeCliColumns: [...normalizedColumns],
        customCliPlatforms: normalizedCustom.map(platform => ({ ...platform }))
      }
    }
  } catch (err) {
    console.error('Failed to load panel settings:', err)
  }
}

function normalizeCustomCliEdits() {
  customCliPlatforms.value = normalizeCustomCliPlatforms(customCliPlatforms.value)
  homeCliColumns.value = normalizeHomeCliColumns(homeCliColumns.value, customCliPlatforms.value)
}

function handleHomeCliSlotChange(index, value) {
  const next = [...homeCliColumns.value]
  const duplicateIndex = next.findIndex((item, itemIndex) => item === value && itemIndex !== index)
  next[index] = value
  if (duplicateIndex >= 0) {
    next[duplicateIndex] = homeCliColumns.value[index]
  }
  homeCliColumns.value = normalizeHomeCliColumns(next, customCliPlatforms.value)
}

function addCustomCliPlatform() {
  const count = customCliPlatforms.value.length + 1
  customCliPlatforms.value.push({
    key: `custom-cli-${count}`,
    name: `Custom CLI ${count}`,
    command: '',
    configDir: '',
    icon: '',
    color: '',
    enabled: true
  })
  normalizeCustomCliEdits()
}

function removeCustomCliPlatform(index) {
  customCliPlatforms.value.splice(index, 1)
  normalizeCustomCliEdits()
}

function resetHomeCliColumns() {
  homeCliColumns.value = [...DEFAULT_HOME_CLI_COLUMNS]
}

async function saveHomeCliSettings() {
  savingHomeCli.value = true
  try {
    normalizeCustomCliEdits()
    const custom = normalizeCustomCliPlatforms(customCliPlatforms.value)
    const columns = normalizeHomeCliColumns(homeCliColumns.value, custom)
    const response = await getUIConfig()
    const baseConfig = response.success && response.config ? response.config : {}
    const saveResult = await saveUIConfig({
      ...baseConfig,
      customCliPlatforms: custom,
      homeCliColumns: columns,
      dashboardChannelOrder: columns
    })
    if (!saveResult.success) {
      throw new Error(saveResult.message || '保存失败')
    }
    customCliPlatforms.value = custom.map(platform => ({ ...platform }))
    homeCliColumns.value = columns
    originalHomeCliSettings.value = {
      homeCliColumns: [...columns],
      customCliPlatforms: custom.map(platform => ({ ...platform }))
    }
    try {
      localStorage.setItem('dashboardChannelOrder', JSON.stringify(columns))
    } catch {}
    window.dispatchEvent(new CustomEvent('home-cli-columns-change', { detail: { homeCliColumns: columns, customCliPlatforms: custom } }))
    message.success('首页 CLI 显示已保存')
  } catch (err) {
    message.error('保存失败: ' + err.message)
  } finally {
    savingHomeCli.value = false
  }
}

// 保存面板可见性设置
async function savePanelSettings() {
  try {
    await updateNestedUIConfig('panelVisibility', 'showChannels', showChannels.value)
    await updateNestedUIConfig('panelVisibility', 'showLogs', showLogs.value)
    await updateNestedUIConfig('channelBalance', 'showRemaining', showChannelBalance.value)
  } catch (err) {
    console.error('Failed to save panel settings:', err)
  }
}

// 处理显示渠道列表切换
function handleShowChannelsChange(value) {
  showChannels.value = value
  savePanelSettings()
  // 通知 Layout 组件更新
  window.dispatchEvent(new CustomEvent('panel-visibility-change', {
    detail: { showChannels: value, showLogs: showLogs.value }
  }))
}

// 处理显示日志切换
function handleShowLogsChange(value) {
  showLogs.value = value
  savePanelSettings()
  // 通知 Layout 组件更新
  window.dispatchEvent(new CustomEvent('panel-visibility-change', {
    detail: { showChannels: showChannels.value, showLogs: value }
  }))
}

// 处理剩余金额显示切换
function handleShowChannelBalanceChange(value) {
  showChannelBalance.value = value
  savePanelSettings()
  window.dispatchEvent(new CustomEvent('channel-balance-visibility-change', {
    detail: { showRemaining: value }
  }))
}

// 会话绑定开关变化时立即保存
async function handleSessionBindingChange(value) {
  try {
    const response = await fetch('/api/config/advanced', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ports: ports.value,
        maxLogs: advancedSettings.value.maxLogs,
        statsInterval: advancedSettings.value.statsInterval,
        enableSessionBinding: value
      })
    })
    if (response.ok) {
      originalAdvancedSettings.value.enableSessionBinding = value
      message.success(value ? '会话绑定已开启' : '会话绑定已关闭')
    } else {
      // 保存失败，回滚开关状态
      advancedSettings.value.enableSessionBinding = !value
      message.error('保存失���')
    }
  } catch (error) {
    console.error('Failed to save session binding:', error)
    advancedSettings.value.enableSessionBinding = !value
    message.error('保存失败: ' + error.message)
  }
}

// 加载端口和高级配置
async function loadPortsConfig() {
  try {
    const response = await fetch('/api/config/advanced')
    if (response.ok) {
      const data = await response.json()
      ports.value = {
        webUI: data.ports?.webUI || 19999,
        proxy: data.ports?.proxy || 20088,
        codexProxy: data.ports?.codexProxy || 20089,
        geminiProxy: data.ports?.geminiProxy || 20090,
        opencodeProxy: data.ports?.opencodeProxy || 20091,
        piProxy: data.ports?.piProxy || 20092
      }
      originalPorts.value = { ...ports.value }

      advancedSettings.value = {
        maxLogs: data.maxLogs || 100,
        statsInterval: data.statsInterval || 30,
        enableSessionBinding: data.enableSessionBinding !== false
      }
      originalAdvancedSettings.value = { ...advancedSettings.value }
    }
  } catch (error) {
    console.error('Failed to load advanced config:', error)
  }
}

// 加载通知设置
async function loadNotificationSettings() {
  try {
    const response = await fetch('/api/hooks')
    if (response.ok) {
      const data = await response.json()
      const nextSettings = createNotificationSettingsState(data)
      notificationSettings.value = nextSettings
      originalNotificationSettings.value = JSON.parse(JSON.stringify(nextSettings))
      // 获取平台信息用于显示安装提示
      notificationPlatform.value = data.platform || ''
      refreshBrowserNotificationPermission()
    }
  } catch (error) {
    console.error('Failed to load notification settings:', error)
  }
}

// 保存通知设置
async function handleSaveNotification() {
  savingNotification.value = true
  try {
    const needsBrowserPermission = notificationHookPlatforms.some((platform) => {
      const state = notificationSettings.value[platform.key]
      return state.enabled && state.type === 'browser'
    })

    if (needsBrowserPermission) {
      await ensureBrowserNotificationPermission()
    }

    const response = await fetch('/api/hooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platforms: Object.fromEntries(
          notificationHookPlatforms.map(platform => [
            platform.key,
            {
              enabled: notificationSettings.value[platform.key].enabled,
              type: notificationSettings.value[platform.key].type
            }
          ])
        ),
        remoteNotifications: {
          providers: notificationSettings.value.remoteNotifications.providers
        }
      })
    })

    if (response.ok) {
      const data = await response.json()
      const nextSettings = createNotificationSettingsState(data)
      notificationSettings.value = nextSettings
      originalNotificationSettings.value = JSON.parse(JSON.stringify(nextSettings))
      notificationPlatform.value = data.platform || notificationPlatform.value
      message.success('通知设置已保存')
    } else {
      const error = await response.json()
      message.error('保存失败：' + (error.error || '未知错误'))
    }
  } catch (error) {
    console.error('Failed to save notification settings:', error)
    message.error('保存失败：' + error.message)
  } finally {
    savingNotification.value = false
  }
}

function resetSecurityForm() {
  securityForm.value = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  }
}

async function loadSecurityStatus(force = false) {
  if (securityStatusLoading.value && securityStatusPromise) {
    return securityStatusPromise
  }
  if (securityStatusLoaded.value && !force) {
    return Promise.resolve()
  }

  securityStatusLoading.value = true
  securityStatusPromise = (async () => {
    try {
      const response = await getSecurityStatus()
      if (response.success) {
        securityStatus.value = {
          hasPassword: Boolean(response.hasPassword)
        }
        securityStatusLoaded.value = true
      }
    } catch (error) {
      console.error('Failed to load security status:', error)
    } finally {
      securityStatusLoading.value = false
      securityStatusPromise = null
    }
  })()
  return securityStatusPromise
}

async function handleSaveSecurity() {
  if (!securityFormReady.value) {
    message.warning('请完善密码信息')
    return
  }

  const isUpdate = securityStatus.value.hasPassword
  savingSecurity.value = true
  try {
    const payload = {
      newPassword: securityForm.value.newPassword
    }
    if (securityStatus.value.hasPassword) {
      payload.currentPassword = securityForm.value.currentPassword
    }
    const response = await setSecurityPassword(payload)
    if (response.success) {
      securityStatus.value.hasPassword = true
      securityStatusLoaded.value = true
      resetSecurityForm()
      message.success(isUpdate ? '密码已更新' : '密码已设置')
    } else {
      message.error(response.error || '保存失败')
    }
  } catch (error) {
    message.error(error.response?.data?.error || '保存失败')
  } finally {
    savingSecurity.value = false
  }
}

// 保存端口和高级配置
async function handleSavePorts() {
  savingPorts.value = true
  try {
    const response = await fetch('/api/config/advanced', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ports: ports.value,
        maxLogs: advancedSettings.value.maxLogs,
        statsInterval: advancedSettings.value.statsInterval,
        enableSessionBinding: advancedSettings.value.enableSessionBinding
      })
    })

    if (response.ok) {
      originalPorts.value = { ...ports.value }
      originalAdvancedSettings.value = { ...advancedSettings.value }

      // 广播配置更新事件
      window.dispatchEvent(new CustomEvent('advanced-config-change', {
        detail: {
          maxLogs: advancedSettings.value.maxLogs,
          statsInterval: advancedSettings.value.statsInterval
        }
      }))

      message.success('配置已保存，端口修改需要重启服务器生效')
    } else {
      const error = await response.json()
      message.error('保存失败：' + (error.error || '未知错误'))
    }
  } catch (error) {
    console.error('Failed to save advanced config:', error)
    message.error('保存失败：' + error.message)
  } finally {
    savingPorts.value = false
  }
}

// 加载开机自启状态
async function loadAutoStartStatus() {
  try {
    const response = await getAutoStartStatus()
    if (response && response.success) {
      autoStartEnabled.value = response.data?.enabled || false
    } else {
      console.warn('Failed to load autostart status:', response?.message)
      // 如果加载失败，默认为未启用
      autoStartEnabled.value = false
    }
  } catch (err) {
    console.error('Failed to load autostart status:', err)
    autoStartEnabled.value = false
  }
}

// 启用开机自启
async function handleEnableAutoStart() {
  autoStartLoading.value = true
  try {
    const response = await enableAutoStart()
    if (response.success) {
      autoStartEnabled.value = true
      message.success('开机自启已启用')
    } else {
      const errorMsg = response.message || '未知错误'
      // 检查是否是警告类信息（需要先启动服务）
      if (errorMsg.includes('暂无运行中的进程') || errorMsg.includes('请先启动')) {
        message.warning(errorMsg)
      } else {
        message.error(errorMsg)
      }
    }
  } catch (err) {
    console.error('Failed to enable autostart:', err)
    message.error(err.message || '启用失败：未知错误')
  } finally {
    autoStartLoading.value = false
  }
}

// 禁用开机自启
async function handleDisableAutoStart() {
  autoStartLoading.value = true
  try {
    const response = await disableAutoStart()
    if (response.success) {
      autoStartEnabled.value = false
      message.success('开机自启已禁用')
    } else {
      const errorMsg = response.message || '未知错误'
      // 检查是否是警告类信息（未启用状态）
      if (errorMsg.includes('未启用') || errorMsg.includes('不存在')) {
        message.warning(errorMsg)
      } else {
        message.error(errorMsg)
      }
    }
  } catch (err) {
    console.error('Failed to disable autostart:', err)
    message.error(err.message || '禁用失败：未知错误')
  } finally {
    autoStartLoading.value = false
  }
}

// 加载设置
onMounted(() => {
  refreshBrowserNotificationPermission()
  loadPanelSettings()
  loadSecurityStatus()
  loadModelMetadata()
})

// 监听抽屉打开，加载数据
watch(show, (newVal) => {
  if (newVal) {
    loadPanelSettings()
    loadPortsConfig()
    loadAutoStartStatus()
    loadNotificationSettings()
    loadModelMetadata()
    loadSecurityStatus(true)
  } else {
    resetSecurityForm()
  }
})

watch(activeMenu, (newVal, oldVal) => {
  if (newVal === 'security') {
    loadSecurityStatus()
  }
  if (oldVal === 'security' && newVal !== 'security') {
    resetSecurityForm()
  }
})
</script>

<style scoped>
.settings-container {
  display: flex;
  height: 100vh;
  gap: 0;
}

/* 左侧边栏 */
.settings-sidebar {
  width: 240px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-primary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

[data-theme="dark"] .settings-sidebar {
  background: rgba(15, 23, 42, 0.5);
  border-right: 1px solid rgba(148, 163, 184, 0.1);
}

.sidebar-header {
  padding: 28px 20px 24px;
  border-bottom: 1px solid var(--border-primary);
  display: flex;
  align-items: center;
  gap: 12px;
}

[data-theme="dark"] .sidebar-header {
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.sidebar-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.settings-menu {
  flex: 1;
  padding: 16px 12px;
  overflow-y: auto;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.menu-item:hover {
  background: var(--hover-bg);
}

[data-theme="dark"] .menu-item:hover {
  background: rgba(71, 85, 105, 0.25);
}

.menu-item.active {
  background: rgba(148, 163, 184, 0.15);
}

[data-theme="dark"] .menu-item.active {
  background: linear-gradient(90deg,
    rgba(148, 163, 184, 0.2) 0%,
    rgba(148, 163, 184, 0.15) 100%
  );
  border: 1px solid rgba(148, 163, 184, 0.25);
  box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.1);
}

.menu-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 60%;
  background: var(--border-secondary);
  border-radius: 0 2px 2px 0;
}

[data-theme="dark"] .menu-item.active::before {
  background: linear-gradient(180deg,
    rgba(148, 163, 184, 0.9) 0%,
    rgba(148, 163, 184, 0.7) 50%,
    rgba(148, 163, 184, 0.5) 100%
  );
  box-shadow: 0 0 8px rgba(148, 163, 184, 0.3);
}

.menu-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: all 0.25s ease;
}

.menu-item:hover .menu-icon {
  color: var(--text-primary);
  transform: scale(1.1);
}

.menu-item.active .menu-icon {
  color: var(--text-primary);
}

[data-theme="dark"] .menu-item.active .menu-icon {
  color: rgba(148, 163, 184, 0.9);
}

.menu-label {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  transition: all 0.2s ease;
}

.menu-item.active .menu-label {
  font-weight: 600;
  color: var(--text-primary);
}

[data-theme="dark"] .menu-item.active .menu-label {
  color: rgba(148, 163, 184, 0.95);
  font-weight: 600;
}

/* 右侧内容区 */
.settings-content {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-primary);
}

.settings-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 28px 32px;
  border-bottom: 1px solid var(--border-primary);
}

[data-theme="dark"] .panel-header {
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.panel-title-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.panel-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.panel-subtitle {
  font-size: 13px;
  display: block;
  margin-top: 6px;
}

.panel-body {
  flex: 1;
  padding: 28px;
  overflow-y: auto;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.setting-label {
  display: flex;
  flex-direction: column;
}

.panel-footer {
  padding: 20px 32px;
  border-top: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

[data-theme="dark"] .panel-footer {
  border-top: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(15, 23, 42, 0.5);
}

/* Naive UI 组件样式覆盖 */
:deep(.n-select) {
  width: 100%;
}

:deep(.n-drawer-body-content-wrapper) {
  padding: 0 !important;
}

:deep(.n-drawer-header) {
  display: none !important;
}

:deep(.n-drawer-body) {
  padding: 0 !important;
}

:deep(.n-drawer-content) {
  display: flex;
  flex-direction: column;
  height: 100%;
}

:deep(.n-drawer-content__body) {
  flex: 1;
  padding: 0 !important;
  overflow: hidden;
}

/* 可见性选项样式 */
.visibility-options {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.visibility-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  transition: all 0.2s ease;
}

[data-theme="dark"] .visibility-item {
  background: rgba(30, 41, 59, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.visibility-item:hover {
  border-color: var(--border-secondary);
  box-shadow: 0 2px 8px rgba(148, 163, 184, 0.1);
}

.visibility-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  margin-right: 16px;
}

/* 简化主题选择器样式 */
.simple-theme-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.simple-theme-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}

[data-theme="dark"] .simple-theme-item {
  background: rgba(30, 41, 59, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.simple-theme-item:hover {
  border-color: var(--border-secondary);
  box-shadow: 0 2px 8px rgba(148, 163, 184, 0.1);
}

.simple-theme-item.active {
  border-color: var(--border-secondary);
  background: rgba(148, 163, 184, 0.08);
}

[data-theme="dark"] .simple-theme-item.active {
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(148, 163, 184, 0.15);
}

.simple-theme-item .theme-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
  transition: all 0.2s ease;
}

.simple-theme-item:hover .theme-icon {
  color: var(--text-primary);
  transform: scale(1.1);
}

.simple-theme-item.active .theme-icon {
  color: var(--text-primary);
}

[data-theme="dark"] .simple-theme-item.active .theme-icon {
  color: rgba(148, 163, 184, 0.9);
}

.theme-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.theme-check {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 端口配置样式 */
.ports-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.port-field {
  display: flex;
  flex-direction: column;
}

.port-field :deep(.n-input-number) {
  width: 100%;
}

.port-field :deep(.n-input-number .n-input__input) {
  font-family: monospace;
  font-size: 13px;
}

.home-cli-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.home-cli-slots {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.home-cli-slot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.custom-cli-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.custom-cli-item {
  padding: 10px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-secondary);
}

[data-theme="dark"] .custom-cli-item {
  background: rgba(30, 41, 59, 0.4);
  border-color: rgba(148, 163, 184, 0.15);
}

.custom-cli-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.custom-cli-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.custom-cli-actions .n-button {
  margin-left: auto;
}

.home-cli-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* 高级设置选项样式 */
.advanced-options {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.option-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  transition: all 0.2s ease;
}

[data-theme="dark"] .option-field {
  background: rgba(30, 41, 59, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.option-field:hover {
  border-color: var(--border-secondary);
  box-shadow: 0 2px 8px rgba(148, 163, 184, 0.1);
}

.option-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  margin-right: 16px;
}


/* 通知设置样式 */
.notification-options {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.notification-type-section {
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  margin-top: 8px;
}

[data-theme="dark"] .notification-type-section {
  background: rgba(30, 41, 59, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.radio-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}

.remote-provider-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 220px) auto 1fr;
  align-items: center;
  gap: 10px;
}

.remote-provider-card {
  padding: 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.remote-provider-card:hover {
  border-color: var(--border-secondary);
  box-shadow: 0 2px 8px rgba(148, 163, 184, 0.1);
}

[data-theme="dark"] .remote-provider-card {
  background: rgba(30, 41, 59, 0.4);
  border-color: rgba(148, 163, 184, 0.15);
}

.remote-provider-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.remote-provider-title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.remote-provider-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

[data-theme="dark"] .remote-provider-avatar {
  background: rgba(15, 23, 42, 0.55);
  border-color: rgba(148, 163, 184, 0.16);
}

.remote-provider-title {
  min-width: 0;
}

.remote-provider-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 3px;
}

.remote-provider-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.remote-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.remote-field-wide {
  grid-column: 1 / -1;
}

.remote-field-label {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
}

.remote-provider-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-primary);
}

[data-theme="dark"] .remote-provider-actions {
  border-top-color: rgba(148, 163, 184, 0.12);
}

@media (max-width: 768px) {
  .remote-provider-toolbar {
    grid-template-columns: 1fr;
  }

  .remote-provider-header,
  .remote-provider-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .remote-provider-fields {
    grid-template-columns: 1fr;
  }
}

/* 安全设置样式 */
.security-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.security-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 360px;
}

.security-error {
  font-size: 12px;
  color: #d03050;
}

/* 命令配置卡片样式 */
.command-config-card {
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  padding: 16px;
  background: var(--bg-secondary);
  margin-bottom: 16px;
  transition: all 0.2s ease;
}

.command-config-card:last-child {
  margin-bottom: 0;
}

.command-config-card:hover {
  border-color: var(--border-secondary);
  box-shadow: 0 2px 8px rgba(148, 163, 184, 0.1);
}

[data-theme="dark"] .command-config-card {
  background: rgba(30, 41, 59, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

[data-theme="dark"] .command-config-card:hover {
  border-color: rgba(148, 163, 184, 0.3);
  box-shadow: 0 2px 8px rgba(148, 163, 184, 0.1);
}

.command-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-primary);
}

[data-theme="dark"] .command-card-header {
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.command-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.command-field {
  display: flex;
  flex-direction: column;
}

.command-field :deep(.n-input) {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
}

.command-field :deep(.n-input .n-input__input-el) {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 13px;
}

/* Model metadata editor */
.model-meta-editor {
  padding: 4px 2px 8px;
}

.model-meta-section {
  background: var(--bg-secondary, rgba(0,0,0,0.03));
  border-radius: 8px;
  padding: 10px 12px;
}

.speed-test-defaults {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.speed-test-default-row {
  display: grid;
  grid-template-columns: 132px 1fr;
  gap: 10px;
  align-items: center;
}

.speed-test-default-label {
  min-width: 0;
}

/* Model toolbar */
.model-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.model-filter-row {
  margin-bottom: 12px;
}

/* Model card list */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-card {
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.2s;
}

.model-card:hover {
  border-color: var(--border-hover, rgba(99, 179, 237, 0.4));
}

.model-card.expanded {
  border-color: var(--primary-color, #63b3ed);
}

.model-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: var(--bg-secondary, rgba(0,0,0,0.02));
  transition: background 0.15s;
}

.model-card-header:hover {
  background: var(--bg-hover, rgba(0,0,0,0.04));
}

.expand-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform 0.2s;
}

.model-card.expanded .expand-icon {
  transform: rotate(90deg);
}

.model-card-id {
  flex: 1;
  font-size: 12px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  color: var(--text-primary);
}

.model-card-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.model-card-body {
  border-top: 1px solid var(--border-primary);
  background: var(--bg-primary);
}

[data-theme="dark"] .model-card {
  border-color: rgba(148, 163, 184, 0.15);
}

[data-theme="dark"] .model-card:hover {
  border-color: rgba(99, 179, 237, 0.3);
}

[data-theme="dark"] .model-card.expanded {
  border-color: rgba(99, 179, 237, 0.5);
}

[data-theme="dark"] .model-card-header {
  background: rgba(30, 41, 59, 0.4);
}

[data-theme="dark"] .model-card-header:hover {
  background: rgba(30, 41, 59, 0.6);
}

[data-theme="dark"] .model-card-body {
  border-color: rgba(148, 163, 184, 0.15);
}

@media (max-width: 768px) {
  .speed-test-default-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .home-cli-slots,
  .custom-cli-grid {
    grid-template-columns: 1fr;
  }
}
</style>

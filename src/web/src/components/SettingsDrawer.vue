<template>
  <n-drawer v-model:show="show" :width="680" placement="right" :show-mask="true">
    <n-drawer-content :show-header="false" closable :native-scrollbar="false">
      <div class="settings-container">
        <!-- 左侧菜单 -->
        <div class="settings-sidebar">
          <div class="sidebar-header">
            <n-icon size="20" color="#18a058">
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
          <!-- 终端工具设置 -->
          <div v-show="activeMenu === 'terminal'" class="settings-panel">
            <div class="panel-header">
              <div class="panel-title-row">
                <n-icon size="24" color="#18a058">
                  <TerminalOutline />
                </n-icon>
                <div>
                  <h3 class="panel-title">终端工具</h3>
                  <n-text depth="3" class="panel-subtitle">选择启动会话时使用的终端工具</n-text>
                </div>
              </div>
            </div>

            <div class="panel-body">
              <n-spin :show="loading">
                <div class="setting-group">
                  <div class="setting-item">
                    <div class="setting-label">
                      <n-text strong>选择终端</n-text>
                      <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                        系统将使用所选终端工具启动 ClaudeCode 会话
                      </n-text>
                    </div>

                    <n-select
                      v-model:value="selectedTerminal"
                      :options="terminalOptions"
                      placeholder="选择终端工具"
                      size="large"
                      @update:value="handleTerminalChange"
                    />
                  </div>

                  <n-alert v-if="!availableTerminals.length && !loading" type="warning" :bordered="false" style="margin-top: 16px;">
                    <template #icon>
                      <n-icon><WarningOutline /></n-icon>
                    </template>
                    未检测到可用的终端工具
                  </n-alert>

                  <div v-if="selectedTerminalInfo" class="terminal-info">
                    <n-divider style="margin: 20px 0;" />
                    <div class="info-card">
                      <div class="info-row">
                        <n-text depth="3" class="info-label">当前终端：</n-text>
                        <n-tag type="success" :bordered="false" size="medium">
                          <template #icon>
                            <n-icon><CheckmarkCircleOutline /></n-icon>
                          </template>
                          {{ selectedTerminalInfo.name }}
                        </n-tag>
                      </div>
                      <div class="info-row">
                        <n-text depth="3" class="info-label">执行命令：</n-text>
                        <n-text code class="info-value">{{ selectedTerminalInfo.command }}</n-text>
                      </div>
                      <div v-if="selectedTerminalInfo.isDefault" class="info-row">
                        <n-tag type="info" :bordered="false" size="small">
                          <template #icon>
                            <n-icon><StarOutline /></n-icon>
                          </template>
                          系统默认终端
                        </n-tag>
                      </div>
                    </div>
                  </div>
                </div>
              </n-spin>
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
                  :loading="saving"
                  :disabled="!selectedTerminal || selectedTerminal === originalSelectedTerminal"
                  @click="handleSave"
                >
                  <template #icon>
                    <n-icon><SaveOutline /></n-icon>
                  </template>
                  保存设置
                </n-button>
              </n-space>
            </div>
          </div>

          <!-- 外观设置面板 -->
          <div v-show="activeMenu === 'appearance'" class="settings-panel">
            <div class="panel-header">
              <div class="panel-title-row">
                <n-icon size="24" color="#18a058">
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

          <div v-show="activeMenu === 'advanced'" class="settings-panel">
            <div class="panel-header">
              <div class="panel-title-row">
                <n-icon size="24" color="#18a058">
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
                        placeholder="10099"
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
                        placeholder="10088"
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
                        placeholder="10089"
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
                        placeholder="10090"
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

                <!-- 成本计算设置 -->
                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>成本计算</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      自定义每百万 Tokens 的单价（USD），便于估算当日成本
                    </n-text>
                  </div>

                  <div class="pricing-section">
                    <!-- Claude -->
                    <div class="pricing-card claude-card">
                      <div class="pricing-card-header">
                        <div>
                          <n-text strong style="font-size: 15px;">Claude</n-text>
                          <n-text depth="3" style="font-size: 12px; display: block;">USD / 1M Tokens</n-text>
                        </div>
                        <div class="pricing-toggle">
                          <n-text depth="3" style="font-size: 12px; margin-right: 8px;">自定义单价</n-text>
                          <n-switch
                            size="small"
                            :checked-value="'custom'"
                            :unchecked-value="'auto'"
                            v-model:value="pricingSettings.claude.mode"
                          />
                        </div>
                      </div>
                      <div class="pricing-hint">
                        {{ pricingSettings.claude.mode === 'custom' ? '立即按自定义单价计算成本' : '使用官方定价自动计算' }}
                      </div>
                      <div class="pricing-grid">
                        <div class="option-field">
                          <div class="option-label">
                            <n-text depth="2" style="font-size: 13px;">输入 Tokens</n-text>
                            <n-text depth="3" style="font-size: 12px;">Input</n-text>
                          </div>
                          <n-input-number
                            v-model:value="pricingSettings.claude.input"
                            :precision="4"
                            :step="0.01"
                            :min="0"
                            :disabled="pricingSettings.claude.mode !== 'custom'"
                            style="width: 100%;"
                          />
                        </div>
                        <div class="option-field">
                          <div class="option-label">
                            <n-text depth="2" style="font-size: 13px;">输出 Tokens</n-text>
                            <n-text depth="3" style="font-size: 12px;">Output</n-text>
                          </div>
                          <n-input-number
                            v-model:value="pricingSettings.claude.output"
                            :precision="4"
                            :step="0.01"
                            :min="0"
                            :disabled="pricingSettings.claude.mode !== 'custom'"
                            style="width: 100%;"
                          />
                        </div>
                        <div class="option-field">
                          <div class="option-label">
                            <n-text depth="2" style="font-size: 13px;">缓存写入</n-text>
                            <n-text depth="3" style="font-size: 12px;">Cache Write</n-text>
                          </div>
                          <n-input-number
                            v-model:value="pricingSettings.claude.cacheCreation"
                            :precision="4"
                            :step="0.01"
                            :min="0"
                            :disabled="pricingSettings.claude.mode !== 'custom'"
                            style="width: 100%;"
                          />
                        </div>
                        <div class="option-field">
                          <div class="option-label">
                            <n-text depth="2" style="font-size: 13px;">缓存命中</n-text>
                            <n-text depth="3" style="font-size: 12px;">Cache Hit</n-text>
                          </div>
                          <n-input-number
                            v-model:value="pricingSettings.claude.cacheRead"
                            :precision="4"
                            :step="0.01"
                            :min="0"
                            :disabled="pricingSettings.claude.mode !== 'custom'"
                            style="width: 100%;"
                          />
                        </div>
                      </div>
                    </div>

                    <!-- Codex -->
                    <div class="pricing-card codex-card">
                      <div class="pricing-card-header">
                        <div>
                          <n-text strong style="font-size: 15px;">Codex</n-text>
                          <n-text depth="3" style="font-size: 12px; display: block;">USD / 1M Tokens</n-text>
                        </div>
                        <div class="pricing-toggle">
                          <n-text depth="3" style="font-size: 12px; margin-right: 8px;">自定义单价</n-text>
                          <n-switch
                            size="small"
                            :checked-value="'custom'"
                            :unchecked-value="'auto'"
                            v-model:value="pricingSettings.codex.mode"
                          />
                        </div>
                      </div>
                      <div class="pricing-hint">
                        {{ pricingSettings.codex.mode === 'custom' ? '自定义单价' : '使用官方单价' }}
                      </div>
                      <div class="pricing-grid">
                        <div class="option-field">
                          <div class="option-label">
                            <n-text depth="2" style="font-size: 13px;">输入 Tokens</n-text>
                          </div>
                          <n-input-number
                            v-model:value="pricingSettings.codex.input"
                            :precision="4"
                            :step="0.01"
                            :min="0"
                            :disabled="pricingSettings.codex.mode !== 'custom'"
                            style="width: 100%;"
                          />
                        </div>
                        <div class="option-field">
                          <div class="option-label">
                            <n-text depth="2" style="font-size: 13px;">输出 Tokens</n-text>
                          </div>
                          <n-input-number
                            v-model:value="pricingSettings.codex.output"
                            :precision="4"
                            :step="0.01"
                            :min="0"
                            :disabled="pricingSettings.codex.mode !== 'custom'"
                            style="width: 100%;"
                          />
                        </div>
                      </div>
                    </div>

                    <!-- Gemini -->
                    <div class="pricing-card gemini-card">
                      <div class="pricing-card-header">
                        <div>
                          <n-text strong style="font-size: 15px;">Gemini</n-text>
                          <n-text depth="3" style="font-size: 12px; display: block;">USD / 1M Tokens</n-text>
                        </div>
                        <div class="pricing-toggle">
                          <n-text depth="3" style="font-size: 12px; margin-right: 8px;">自定义单价</n-text>
                          <n-switch
                            size="small"
                            :checked-value="'custom'"
                            :unchecked-value="'auto'"
                            v-model:value="pricingSettings.gemini.mode"
                          />
                        </div>
                      </div>
                      <div class="pricing-hint">
                        {{ pricingSettings.gemini.mode === 'custom' ? '自定义单价' : '使用官方单价' }}
                      </div>
                      <div class="pricing-grid">
                        <div class="option-field">
                          <div class="option-label">
                            <n-text depth="2" style="font-size: 13px;">输入 Tokens</n-text>
                          </div>
                          <n-input-number
                            v-model:value="pricingSettings.gemini.input"
                            :precision="4"
                            :step="0.01"
                            :min="0"
                            :disabled="pricingSettings.gemini.mode !== 'custom'"
                            style="width: 100%;"
                          />
                        </div>
                        <div class="option-field">
                          <div class="option-label">
                            <n-text depth="2" style="font-size: 13px;">输出 Tokens</n-text>
                          </div>
                          <n-input-number
                            v-model:value="pricingSettings.gemini.output"
                            :precision="4"
                            :step="0.01"
                            :min="0"
                            :disabled="pricingSettings.gemini.mode !== 'custom'"
                            style="width: 100%;"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <n-divider />

                <!-- 开机自启设置 -->
                <div class="setting-item">
                  <div class="setting-label">
                    <n-text strong>开机自启</n-text>
                    <n-text depth="3" style="font-size: 13px; margin-top: 4px;">
                      启用此选项后，重启电脑时 Coding-Tool 会自动启动
                    </n-text>
                  </div>

                  <div style="margin-top: 16px;">
                    <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px; border-left: 3px solid #18a058;">
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
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, computed, watch, onMounted, markRaw } from 'vue'
import {
  NDrawer, NDrawerContent, NSpace, NText, NSelect, NButton, NAlert,
  NIcon, NBadge, NSpin, NDivider, NTag, NEmpty, NSwitch, NInputNumber
} from 'naive-ui'
import {
  SettingsOutline, TerminalOutline, ColorPaletteOutline, OptionsOutline,
  SaveOutline, CheckmarkCircleOutline, StarOutline, WarningOutline,
  SunnyOutline, MoonOutline
} from '@vicons/ionicons5'
import { getAvailableTerminals, saveTerminalConfig } from '../api/terminal'
import { getUIConfig, updateNestedUIConfig } from '../api/ui-config'
import { getAutoStartStatus, enableAutoStart, disableAutoStart } from '../api/pm2'
import message from '../utils/message'
import { useTheme } from '../composables/useTheme'

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

const loading = ref(false)
const saving = ref(false)
const availableTerminals = ref([])
const selectedTerminal = ref(null)
const originalSelectedTerminal = ref(null)
const activeMenu = ref('terminal')

// 主题管理
const { isDark, toggleTheme } = useTheme()

// 面板可见性设置
const showChannels = ref(true)
const showLogs = ref(true)

// 端口配置
const ports = ref({
  webUI: 10099,
  proxy: 10088,
  codexProxy: 10089,
  geminiProxy: 10090
})
const originalPorts = ref({
  webUI: 10099,
  proxy: 10088,
  codexProxy: 10089,
  geminiProxy: 10090
})
const savingPorts = ref(false)

// 开机自启配置
const autoStartEnabled = ref(false)
const autoStartLoading = ref(false)
const autoStartStatus = computed(() => autoStartEnabled.value ? '✓ 已启用' : '未启用')
const autoStartHelp = computed(() => {
  if (autoStartEnabled.value) {
    return '重启电脑时 Coding-Tool 会自动启动。如需禁用，点击下方按钮'
  } else {
    return '启用后，重启电脑时 Coding-Tool 会自动启动'
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

const pricingSettings = ref({
  claude: {
    mode: 'auto',
    input: 3,
    output: 15,
    cacheCreation: 3.75,
    cacheRead: 0.3
  },
  codex: {
    mode: 'auto',
    input: 2.5,
    output: 10
  },
  gemini: {
    mode: 'auto',
    input: 1.25,
    output: 5
  }
})
const originalPricingSettings = ref(JSON.parse(JSON.stringify(pricingSettings.value)))

// 检查配置是否有修改
const portsChanged = computed(() => {
  return ports.value.webUI !== originalPorts.value.webUI ||
    ports.value.proxy !== originalPorts.value.proxy ||
    ports.value.codexProxy !== originalPorts.value.codexProxy ||
    ports.value.geminiProxy !== originalPorts.value.geminiProxy ||
    advancedSettings.value.maxLogs !== originalAdvancedSettings.value.maxLogs ||
    advancedSettings.value.statsInterval !== originalAdvancedSettings.value.statsInterval ||
    JSON.stringify(pricingSettings.value) !== JSON.stringify(originalPricingSettings.value)
})

// 菜单项配置
const menuItems = ref([
  {
    key: 'terminal',
    label: '终端工具',
    icon: markRaw(TerminalOutline)
  },
  {
    key: 'appearance',
    label: '外观设置',
    icon: markRaw(ColorPaletteOutline)
  },
  {
    key: 'advanced',
    label: '高级设置',
    icon: markRaw(OptionsOutline)
  }
])

const terminalOptions = computed(() => {
  return availableTerminals.value
    .filter(t => t.available)
    .map(t => ({
      label: `${t.name}${t.isDefault ? ' (默认)' : ''}`,
      value: t.id
    }))
})

function normalizePrice(value, fallback) {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value
  }
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clonePricing(value) {
  return JSON.parse(JSON.stringify(value))
}

const selectedTerminalInfo = computed(() => {
  return availableTerminals.value.find(t => t.id === selectedTerminal.value)
})

// 加载终端列表和当前配置
async function loadTerminals() {
  loading.value = true
  try {
    const data = await getAvailableTerminals()
    availableTerminals.value = data.available || []
    selectedTerminal.value = data.selected || null
    originalSelectedTerminal.value = data.selected || null

    // 如果没有选中的终端，自动选择默认终端
    if (!selectedTerminal.value && availableTerminals.value.length > 0) {
      const defaultTerminal = availableTerminals.value.find(t => t.isDefault)
      if (defaultTerminal) {
        selectedTerminal.value = defaultTerminal.id
      }
    }
  } catch (error) {
    console.error('Failed to load terminals:', error)
    message.error('加载终端列表失败：' + (error.message || '未知错误'))
  } finally {
    loading.value = false
  }
}

// 终端切换处理
function handleTerminalChange(value) {
  // 终端切换，无需额外处理
}

// 保存设置
async function handleSave() {
  if (!selectedTerminal.value) {
    message.warning('请选择一个终端工具')
    return
  }

  saving.value = true
  try {
    await saveTerminalConfig(selectedTerminal.value)
    originalSelectedTerminal.value = selectedTerminal.value
    message.success('设置已保存')
  } catch (error) {
    console.error('Failed to save terminal config:', error)
    message.error('保存失败：' + (error.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

// 加载面板可见性设置
async function loadPanelSettings() {
  try {
    const response = await getUIConfig()
    if (response.success && response.config) {
      showChannels.value = response.config.panelVisibility?.showChannels !== false // default true
      showLogs.value = response.config.panelVisibility?.showLogs !== false // default true
    }
  } catch (err) {
    console.error('Failed to load panel settings:', err)
  }
}

// 保存面板可见性设置
async function savePanelSettings() {
  try {
    await updateNestedUIConfig('panelVisibility', 'showChannels', showChannels.value)
    await updateNestedUIConfig('panelVisibility', 'showLogs', showLogs.value)
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

// 加载端口和高级配置
async function loadPortsConfig() {
  try {
    const response = await fetch('/api/config/advanced')
    if (response.ok) {
      const data = await response.json()
      ports.value = {
        webUI: data.ports?.webUI || 10099,
        proxy: data.ports?.proxy || 10088,
        codexProxy: data.ports?.codexProxy || 10089,
        geminiProxy: data.ports?.geminiProxy || 10090
      }
      originalPorts.value = { ...ports.value }

      advancedSettings.value = {
        maxLogs: data.maxLogs || 100,
        statsInterval: data.statsInterval || 30,
        enableSessionBinding: data.enableSessionBinding !== false
      }
      originalAdvancedSettings.value = { ...advancedSettings.value }

      pricingSettings.value = {
        claude: {
          mode: data.pricing?.claude?.mode === 'custom' ? 'custom' : 'auto',
          input: normalizePrice(data.pricing?.claude?.input, 3),
          output: normalizePrice(data.pricing?.claude?.output, 15),
          cacheCreation: normalizePrice(data.pricing?.claude?.cacheCreation, 3.75),
          cacheRead: normalizePrice(data.pricing?.claude?.cacheRead, 0.3)
        },
        codex: {
          mode: data.pricing?.codex?.mode === 'custom' ? 'custom' : 'auto',
          input: normalizePrice(data.pricing?.codex?.input, 2.5),
          output: normalizePrice(data.pricing?.codex?.output, 10)
        },
        gemini: {
          mode: data.pricing?.gemini?.mode === 'custom' ? 'custom' : 'auto',
          input: normalizePrice(data.pricing?.gemini?.input, 1.25),
          output: normalizePrice(data.pricing?.gemini?.output, 5)
        }
      }
      originalPricingSettings.value = clonePricing(pricingSettings.value)
    }
  } catch (error) {
    console.error('Failed to load advanced config:', error)
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
        enableSessionBinding: advancedSettings.value.enableSessionBinding,
        pricing: pricingSettings.value
      })
    })

    if (response.ok) {
      originalPorts.value = { ...ports.value }
      originalAdvancedSettings.value = { ...advancedSettings.value }
      originalPricingSettings.value = clonePricing(pricingSettings.value)

      // 广播配置更新事件
      window.dispatchEvent(new CustomEvent('advanced-config-change', {
        detail: {
          maxLogs: advancedSettings.value.maxLogs,
          statsInterval: advancedSettings.value.statsInterval,
          pricing: pricingSettings.value
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
  loadPanelSettings()
})

// 监听抽屉打开，加载数据
watch(show, (newVal) => {
  if (newVal) {
    loadTerminals()
    loadPanelSettings()
    loadPortsConfig()
    loadAutoStartStatus()
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
  background: rgba(24, 160, 88, 0.15);
}

[data-theme="dark"] .menu-item.active {
  background: linear-gradient(90deg,
    rgba(5, 150, 105, 0.2) 0%,
    rgba(16, 185, 129, 0.15) 100%
  );
  border: 1px solid rgba(16, 185, 129, 0.25);
  box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.1);
}

.menu-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 60%;
  background: #18a058;
  border-radius: 0 2px 2px 0;
}

[data-theme="dark"] .menu-item.active::before {
  background: linear-gradient(180deg,
    rgba(52, 211, 153, 1) 0%,
    rgba(16, 185, 129, 1) 50%,
    rgba(5, 150, 105, 1) 100%
  );
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
}

.menu-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: all 0.25s ease;
}

.menu-item:hover .menu-icon {
  color: #18a058;
  transform: scale(1.1);
}

.menu-item.active .menu-icon {
  color: #18a058;
}

[data-theme="dark"] .menu-item.active .menu-icon {
  color: #34d399;
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
  color: #18a058;
}

[data-theme="dark"] .menu-item.active .menu-label {
  color: #6ee7b7;
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

.terminal-info {
  margin-top: 8px;
}

.info-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

[data-theme="dark"] .info-card {
  background: rgba(30, 41, 59, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.info-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.info-label {
  min-width: 80px;
  font-size: 13px;
}

.info-value {
  font-size: 13px;
  word-break: break-all;
  flex: 1;
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
  border-color: #18a058;
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.1);
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
  border-color: #18a058;
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.1);
}

.simple-theme-item.active {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.05);
}

[data-theme="dark"] .simple-theme-item.active {
  border-color: #34d399;
  background: rgba(52, 211, 153, 0.1);
}

.simple-theme-item .theme-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
  transition: all 0.2s ease;
}

.simple-theme-item:hover .theme-icon {
  color: #18a058;
  transform: scale(1.1);
}

.simple-theme-item.active .theme-icon {
  color: #18a058;
}

[data-theme="dark"] .simple-theme-item.active .theme-icon {
  color: #34d399;
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
  border-color: #18a058;
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.1);
}

.option-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  margin-right: 16px;
}

.pricing-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pricing-card {
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  padding: 14px;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pricing-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pricing-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.pricing-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pricing-grid .option-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.pricing-grid .option-field:hover {
  border-color: var(--border-secondary);
  background: var(--hover-bg);
}

.pricing-grid .option-label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-right: 12px;
  flex: 1;
}

.pricing-grid .option-field .n-input-number {
  width: 120px !important;
  flex-shrink: 0;
}

[data-theme="dark"] .pricing-grid .option-field {
  background: rgba(30, 41, 59, 0.3);
  border-color: rgba(148, 163, 184, 0.12);
}

[data-theme="dark"] .pricing-grid .option-field:hover {
  background: rgba(30, 41, 59, 0.5);
  border-color: rgba(148, 163, 184, 0.2);
}

.pricing-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>

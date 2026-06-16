import type { SettingCategory } from '@/types/settings'

export const USER_SETTING_CATEGORIES = [
  'notification',
  'privacy',
  'interface',
  'security',
  'preference',
] as const satisfies readonly SettingCategory[]

export const USER_SETTING_KEYS = {
  notification: ['email_notifications', 'web_notifications', 'notification_frequency'],
  privacy: ['profile_visibility', 'activity_visibility', 'contact_visibility'],
  interface: ['theme', 'language', 'timezone', 'post_display'],
  security: ['session_timeout', 'login_notifications', 'two_factor'],
  preference: ['content_filter', 'accessibility', 'auto_save'],
} as const satisfies Record<SettingCategory, readonly string[]>

export type UserSettingCategory = (typeof USER_SETTING_CATEGORIES)[number]
export type UserSettingKey = (typeof USER_SETTING_KEYS)[UserSettingCategory][number]

export function parseUserSettingCategory(value: unknown): UserSettingCategory | null {
  return typeof value === 'string' && USER_SETTING_CATEGORIES.includes(value as UserSettingCategory)
    ? (value as UserSettingCategory)
    : null
}

export function isUserSettingKey(
  category: UserSettingCategory,
  key: unknown
): key is UserSettingKey {
  return typeof key === 'string' && (USER_SETTING_KEYS[category] as readonly string[]).includes(key)
}

'use client';

import { Modal } from '@/components/ui/Modal';
import { useSettings } from '@/components/providers/SettingsProvider';
import { SettingsClient } from './SettingsClient';

/**
 * 设置弹窗。
 * 设置内容体量较大，因此用加宽的居中弹窗承载，避免整页跳转打断创作流程。
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useSettings();

  return (
    <Modal
      open={open}
      title={t('settings.title')}
      description={t('settings.localOnly')}
      size="full"
      onClose={onClose}
    >
      <SettingsClient />
    </Modal>
  );
}

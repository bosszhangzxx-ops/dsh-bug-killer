const NAMESPACE = 'dsh-bug-killer'

let stylesInjected = false

export function injectStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = NAMESPACE
  tag.dataset.pluginCss = `${NAMESPACE}/ui`
  tag.textContent = `
.dbk-trigger {
  appearance: none;
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dbk-trigger:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10));
  color: var(--dsw-alias-label-primary, inherit);
}
.dbk-trigger:disabled { opacity: .5; cursor: default; }
.dbk-trigger:focus-visible,
.dbk-button:focus-visible,
.dbk-icon-button:focus-visible,
.dbk-link-button:focus-visible,
.dbk-directory-entry:focus-visible,
.dbk-textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4f7cff);
  outline-offset: 2px;
}
.dbk-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 999px;
  background: var(--dsw-alias-label-tertiary, #888);
}
.dbk-dot-live {
  background: var(--dsw-alias-state-error-primary, #e5484d);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 18%, transparent);
}
.dbk-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, .46);
  backdrop-filter: blur(3px);
}
.dbk-dialog {
  width: min(680px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-3, #fff);
  color: var(--dsw-alias-label-primary, #171717);
  box-shadow: 0 24px 80px rgba(0, 0, 0, .28);
}
.dbk-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.20));
}
.dbk-header-copy { flex: 1; min-width: 0; }
.dbk-title { margin: 0; font-size: 18px; line-height: 1.35; font-weight: 650; }
.dbk-subtitle {
  margin: 5px 0 0;
  color: var(--dsw-alias-label-tertiary, #707070);
  font-size: 12px;
  line-height: 1.55;
}
.dbk-icon-button {
  appearance: none;
  width: 30px;
  height: 30px;
  flex: none;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 20px;
  cursor: pointer;
}
.dbk-icon-button:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)); }
.dbk-body { padding: 20px 22px; overflow-y: auto; }
.dbk-grid { display: grid; gap: 16px; }
.dbk-field { display: grid; gap: 7px; }
.dbk-label { font-size: 13px; line-height: 1.4; font-weight: 600; }
.dbk-required { margin-left: 3px; color: var(--dsw-alias-state-error-primary, #d33); }
.dbk-textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06));
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 13px;
}
.dbk-textarea { min-height: 128px; resize: vertical; padding: 10px 11px; line-height: 1.55; }
.dbk-help { margin: 0; color: var(--dsw-alias-label-tertiary, #777); font-size: 11px; line-height: 1.5; }
.dbk-project-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 11px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06));
}
.dbk-project-path {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dbk-link-button {
  appearance: none;
  padding: 4px 6px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-brand-primary, #315efb);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dbk-link-button:disabled { opacity: .5; cursor: default; }
.dbk-directory-picker {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24));
  border-radius: 10px;
  background: var(--dsw-alias-bg-base, rgba(127,127,127,.04));
}
.dbk-directory-current {
  margin: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #777);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dbk-directory-list { display: grid; gap: 4px; max-height: 230px; overflow-y: auto; }
.dbk-directory-entry {
  appearance: none;
  width: 100%;
  padding: 7px 9px;
  overflow: hidden;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.dbk-directory-entry:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)); }
.dbk-directory-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dbk-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06));
}
.dbk-card-title { margin: 0; font-size: 14px; font-weight: 650; }
.dbk-card p { margin: 0; color: var(--dsw-alias-label-secondary, inherit); font-size: 12px; line-height: 1.65; }
.dbk-meta { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 12px; line-height: 1.5; }
.dbk-meta-key { color: var(--dsw-alias-label-tertiary, #777); }
.dbk-meta-value { min-width: 0; overflow-wrap: anywhere; }
.dbk-live-row { display: flex; align-items: center; gap: 9px; color: var(--dsw-alias-state-error-primary, #d33); font-weight: 600; }
.dbk-error {
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 40%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 8%, transparent);
  color: var(--dsw-alias-state-error-primary, #b22);
  font-size: 12px;
  line-height: 1.55;
}
.dbk-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 22px 18px;
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.20));
}
.dbk-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 9px; }
.dbk-button {
  appearance: none;
  min-height: 36px;
  padding: 7px 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  border-radius: 9px;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dbk-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)); }
.dbk-button-primary {
  border-color: var(--dsw-alias-brand-primary, #315efb);
  background: var(--dsw-alias-brand-primary, #315efb);
  color: white;
}
.dbk-button-primary:hover:not(:disabled) { filter: brightness(1.05); background: var(--dsw-alias-brand-primary, #315efb); }
.dbk-button-danger { color: var(--dsw-alias-state-error-primary, #c33); }
.dbk-button:disabled { opacity: .5; cursor: default; }
@media (max-width: 640px) {
  .dbk-backdrop { align-items: flex-end; padding: 0; }
  .dbk-dialog { max-height: 92vh; border-radius: 16px 16px 0 0; }
  .dbk-footer { align-items: stretch; flex-direction: column; }
  .dbk-actions { justify-content: stretch; }
  .dbk-actions .dbk-button { flex: 1; }
}
`
  document.head.appendChild(tag)
}

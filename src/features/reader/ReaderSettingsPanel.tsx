// 设置展示与保存分开：父组件继续负责即时预览、300ms 防抖、重试和全局/单书合并。
import { useEffect, useId, useRef, useState } from 'react';
import type { ReadingSettings } from '../../types/models';

export type NumericSettingKey = {
  [K in keyof ReadingSettings]: ReadingSettings[K] extends number ? K : never
}[keyof ReadingSettings];

interface ReaderSettingsPanelProps {
  draft: ReadingSettings;
  scope: 'global' | 'book';
  hasBookOverride: boolean;
  saving: boolean;
  error: string | null;
  onScope: (scope: 'global' | 'book') => void;
  onDraft: (draft: ReadingSettings) => void;
  onNumeric: (key: NumericSettingKey, value: number, persist: boolean) => void;
  onClearOverride: () => void;
}

const LINE_PRESETS: Array<[string, string]> = [['1.5', '紧凑'], ['1.8', '标准'], ['2.1', '宽松']];
const MARGIN_PRESETS = [
  { key: 'narrow', label: '窄', horizontal: 3, vertical: 16 },
  { key: 'standard', label: '标准', horizontal: 6, vertical: 24 },
  { key: 'wide', label: '宽', horizontal: 9, vertical: 32 },
];
const THEMES: Array<{ value: ReadingSettings['theme']; label: string; swatch: string }> = [
  { value: 'light', label: '浅色', swatch: 'bg-[#fbfaf6]' },
  { value: 'sepia', label: '暖色', swatch: 'bg-[#f6ecd8]' },
  { value: 'dark', label: '深色', swatch: 'bg-[#262520]' },
];
const SETTING_ROW = 'flex min-h-12 items-center justify-between gap-3 border-b border-line py-1';

export function ReaderSettingsPanel({ draft, scope, hasBookOverride, saving, error, onScope, onDraft, onNumeric, onClearOverride }: ReaderSettingsPanelProps) {
  const scopeDescriptionId = useId();
  const linePreset = LINE_PRESETS.some(([value]) => Number(value) === draft.line_height_multiplier) ? String(draft.line_height_multiplier) : '';
  // 四个真实边距必须同时命中预设；不能把不对称或精确自定义数值冒充“标准”。
  const marginPreset = MARGIN_PRESETS.find(({ horizontal, vertical }) =>
    draft.margin_left_percent === horizontal && draft.margin_right_percent === horizontal
    && draft.margin_top_px === vertical && draft.margin_bottom_px === vertical,
  );

  return (
    <div className="text-sm text-ink">
      <div className="flex min-h-16 items-center justify-between gap-3 border-b border-line py-2">
        <div className="min-w-0">
          <span className="text-base">仅用于这本书</span>
          <p id={scopeDescriptionId} className="mt-1 text-xs leading-relaxed text-muted">
            {scope === 'book' ? '修改只用于当前书籍，其他书仍使用全局默认。' : hasBookOverride ? '关闭时，修改全局默认；本书已有覆盖的项目保持原值。' : '关闭时，修改会用于所有使用全局默认的书。'}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={scope === 'book'} aria-label="仅用于这本书" aria-describedby={scopeDescriptionId} onClick={() => onScope(scope === 'book' ? 'global' : 'book')} className="flex h-11 w-12 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <span aria-hidden="true" className={`block h-7 w-12 rounded-full p-[3px] transition-colors ${scope === 'book' ? 'bg-accent' : 'bg-line'}`}>
            <span className={`block h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform ${scope === 'book' ? 'translate-x-5' : ''}`} />
          </span>
        </button>
      </div>
      <section aria-label="基础阅读设置">
        {/* 常用字号按设计稿使用滑块；精确键入及步进仍保留在下方更多排版。 */}
        <label className="flex min-h-14 items-center gap-3 border-b border-line py-1">
          <span className="w-[5.25rem] shrink-0"><span className="text-base">字号</span><span className="mt-0.5 block text-xs tabular-nums text-muted">{draft.font_size_px} px</span></span>
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span aria-hidden="true" className="text-sm">A</span>
            <input type="range" min={12} max={32} step={1} value={draft.font_size_px} aria-label="字号滑块" aria-valuetext={`${draft.font_size_px} px`} onChange={(event) => onNumeric('font_size_px', Number(event.target.value), true)} className="h-11 min-w-0 flex-1 accent-accent" />
            <span aria-hidden="true" className="font-reading text-2xl">A</span>
          </span>
        </label>
        <div className="flex min-h-[72px] items-center justify-between gap-3 border-b border-line py-2">
          <span className="shrink-0 text-base">主题</span>
          <div role="group" aria-label="主题" className="flex items-center gap-4">
            {THEMES.map(({ value, label, swatch }) => (
              <button key={value} type="button" aria-label={`${label}主题`} aria-pressed={draft.theme === value} onClick={() => onDraft({ ...draft, theme: value })} className="flex min-w-11 flex-col items-center gap-1 rounded-lg text-xs text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                <span aria-hidden="true" className={`block h-9 w-9 rounded-full border border-ink/25 ${swatch} ${draft.theme === value ? 'outline outline-2 outline-offset-2 outline-accent' : ''}`} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={SETTING_ROW}>
          <SettingLabel label="行距" custom={!linePreset} />
          <SettingSegments label="行距" value={linePreset} options={LINE_PRESETS} onChange={(value) => onNumeric('line_height_multiplier', Number(value), true)} />
        </div>
        <div className={SETTING_ROW}>
          <SettingLabel label="页边距" custom={!marginPreset} />
          <SettingSegments label="页边距" value={marginPreset?.key ?? ''} options={MARGIN_PRESETS.map(({ key, label }) => [key, label])} onChange={(key) => {
            const preset = MARGIN_PRESETS.find((item) => item.key === key);
            if (!preset) return;
            // 一次草稿更新提交四个边距，避免父组件看到半组预设而触发多次重排。
            onDraft({ ...draft, margin_left_percent: preset.horizontal, margin_right_percent: preset.horizontal, margin_top_px: preset.vertical, margin_bottom_px: preset.vertical });
          }} />
        </div>
        <SettingSelect label="字体" value={draft.font_family} onChange={(value) => onDraft({ ...draft, font_family: value as ReadingSettings['font_family'] })} options={[['publisher', '出版方'], ['serif', '衬线'], ['sans', '无衬线'], ['system', '系统']]} />
        <div className={SETTING_ROW}>
          <SettingLabel label="翻页方式" />
          <SettingSegments label="翻页方式" value={draft.flow} options={[['paginated', '分页'], ['scrolled', '滚动']]} onChange={(value) => onDraft({ ...draft, flow: value as ReadingSettings['flow'] })} />
        </div>
      </section>
      {/* 基础预设不替代精确输入：所有原有数值、单位和范围仍可在更多排版中编辑。 */}
      <details>
        <summary className="flex min-h-12 cursor-pointer items-center justify-between border-b border-line text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">更多排版 <span aria-hidden="true" className="text-muted">⌄</span></summary>
        <div>
          <SettingStepper label="字号" value={draft.font_size_px} min={12} max={32} step={1} unit="px" onPreview={(value, persist) => onNumeric('font_size_px', value, persist)} />
          <SettingSelect label="跨页" value={draft.spread} onChange={(value) => onDraft({ ...draft, spread: value as ReadingSettings['spread'] })} options={[['auto', '自动'], ['none', '单页'], ['always', '双页']]} />
          <SettingStepper label="精确行距" value={draft.line_height_multiplier} min={1} max={3} step={0.1} unit="倍" onPreview={(value, persist) => onNumeric('line_height_multiplier', value, persist)} />
          <SettingStepper label="段落间距" value={draft.paragraph_spacing_multiplier} min={0} max={2} step={0.1} unit="倍" onPreview={(value, persist) => onNumeric('paragraph_spacing_multiplier', value, persist)} />
          <SettingStepper label="首行缩进" value={draft.text_indent_em} min={0} max={4} step={0.5} unit="em" onPreview={(value, persist) => onNumeric('text_indent_em', value, persist)} />
          <SettingStepper label="上边距" value={draft.margin_top_px} min={0} max={100} step={1} unit="px" onPreview={(value, persist) => onNumeric('margin_top_px', value, persist)} />
          <SettingStepper label="下边距" value={draft.margin_bottom_px} min={0} max={100} step={1} unit="px" onPreview={(value, persist) => onNumeric('margin_bottom_px', value, persist)} />
          <SettingStepper label="左边距" value={draft.margin_left_percent} min={0} max={20} step={1} unit="%" onPreview={(value, persist) => onNumeric('margin_left_percent', value, persist)} />
          <SettingStepper label="右边距" value={draft.margin_right_percent} min={0} max={20} step={1} unit="%" onPreview={(value, persist) => onNumeric('margin_right_percent', value, persist)} />
          <SettingStepper label="最大列宽" value={draft.max_column_width_px} min={300} max={1200} step={10} unit="px" onPreview={(value, persist) => onNumeric('max_column_width_px', value, persist)} />
        </div>
      </details>
      {error && <p role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs leading-relaxed text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span role="status" aria-live="polite" className="text-xs text-muted">{saving ? '保存中…' : error ? '保存失败，预览已保留' : '已自动保存'}</span>
        {hasBookOverride && <button type="button" disabled={saving} onClick={onClearOverride} className="min-h-10 rounded-xl border border-line px-3 text-xs text-accent hover:bg-accent-soft disabled:opacity-50">清除单书覆盖</button>}
      </div>
    </div>
  );
}

function SettingLabel({ label, custom = false }: { label: string; custom?: boolean }) {
  return <div className="w-[5.25rem] shrink-0"><span className="text-base">{label}</span>{custom && <span className="mt-0.5 block text-xs text-muted">自定义</span>}</div>;
}

function SettingSegments({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <div role="group" aria-label={label} className="grid min-w-0 flex-1 auto-cols-fr grid-flow-col rounded-xl bg-subtle p-1">
      {options.map(([optionValue, optionLabel]) => (
        <button key={optionValue} type="button" aria-pressed={value === optionValue} onClick={() => onChange(optionValue)} className={`min-h-9 min-w-0 rounded-lg px-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${value === optionValue ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

function SettingSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <label className={SETTING_ROW}>
      <span className="shrink-0 text-base">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 max-w-[65%] rounded-lg border border-transparent bg-transparent px-2 text-right text-ink outline-none focus:border-accent">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue} className="bg-surface text-ink">{optionLabel}</option>)}
      </select>
    </label>
  );
}

interface SettingStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onPreview: (value: number, persist: boolean) => void;
}

// 键入时预览，按钮/失焦/Enter 提交；保存策略由调用方保持既有语义。
function SettingStepper({ label, value, min, max, step, unit = '', onPreview }: SettingStepperProps) {
  const decimals = decimalPlaces(step);
  const [text, setText] = useState(formatNumber(value, decimals));
  const isEditingRef = useRef(false);
  useEffect(() => {
    if (!isEditingRef.current) setText(formatNumber(value, decimals));
  }, [value, decimals]);

  const commit = () => {
    const parsed = Number(text);
    const next = clampAndRound(Number.isFinite(parsed) ? parsed : value, min, max, decimals);
    setText(formatNumber(next, decimals));
    onPreview(next, true);
  };
  const stepBy = (direction: -1 | 1) => {
    const next = clampAndRound(value + direction * step, min, max, decimals);
    setText(formatNumber(next, decimals));
    onPreview(next, true);
  };
  return (
    <div className="grid min-h-[62px] grid-cols-[minmax(4.5rem,1fr)_2.5rem_3.5rem_2.5rem_1.5rem] items-center gap-1 border-b border-line py-2 whitespace-nowrap">
      <span className="min-w-0 truncate text-base">{label}</span>
      <button type="button" className="h-10 rounded-lg text-lg text-muted hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => stepBy(-1)} aria-label={`${label}减小`}>−</button>
      <input type="text" inputMode={decimals > 0 ? 'decimal' : 'numeric'} value={text}
        onChange={(event) => {
          const next = event.target.value;
          const pattern = decimals > 0 ? /^\d*(?:\.\d*)?$/ : /^\d*$/;
          if (!pattern.test(next)) return;
          setText(next);
          const parsed = Number(next);
          if (next !== '' && Number.isFinite(parsed)) onPreview(clampAndRound(parsed, min, max, decimals), false);
        }}
        onFocus={() => { isEditingRef.current = true; }}
        onBlur={() => { isEditingRef.current = false; commit(); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur(); }
        }}
        className="h-10 min-w-0 rounded-lg border border-line bg-surface px-1 text-center tabular-nums text-ink outline-none focus:border-accent" aria-label={label}
      />
      <button type="button" className="h-10 rounded-lg text-lg text-muted hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => stepBy(1)} aria-label={`${label}增大`}>+</button>
      <span className="text-xs text-muted">{unit}</span>
    </div>
  );
}

function decimalPlaces(step: number): number {
  const dot = String(step).indexOf('.');
  return dot < 0 ? 0 : String(step).length - dot - 1;
}
function clampAndRound(value: number, min: number, max: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, value)) * factor) / factor;
}
function formatNumber(value: number, decimals: number): string {
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

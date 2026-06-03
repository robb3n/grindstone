import { App, PluginSettingTab, Setting, setIcon, setTooltip, MarkdownRenderer, Notice } from 'obsidian';
import type GrindstonePlugin from '../main';
import { ReviewOrder } from '../card/types';
import { ResetLearningDataModal } from '../view/reset-data-modal';
import { CleanupOrphanCardsModal } from '../view/cleanup-orphans-modal';
import { DEFAULT_SLOGANS } from '../view/tabs/Overview';
import { t, setLang, getLang, Lang, StringKey } from '../i18n';
import { setDayEndHour } from '../util/date';
import { BUY_URL, DEVICE_LIMIT } from '../license';
import type { Entitlement, KeyInfo, AddFailReason } from '../license';

type SectionDef = {
  id: string;
  labelKey: StringKey;
  icon: string;
  render: (container: HTMLElement) => void;
};

export class GrindstoneSettingTab extends PluginSettingTab {
  plugin: GrindstonePlugin;
  private rescanTimer: number | null = null;

  constructor(app: App, plugin: GrindstonePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Trigger/exclude/archive/prefixMatch changes alter how every existing
  // block is matched, so the whole vault has to be re-evaluated. Textarea
  // edits fire onChange per keystroke — debounce so we run fullScan once
  // when the user stops typing.
  private scheduleRescan(): void {
    if (this.rescanTimer != null) window.clearTimeout(this.rescanTimer);
    this.rescanTimer = window.setTimeout(async () => {
      this.rescanTimer = null;
      this.plugin.gsStore.invalidatePrimaryDeckCache();
      await this.plugin.cardManager.fullScan();
      this.plugin.refreshAllWorkspaceViews();
    }, 600);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('gs-settings');

    const SECTIONS: SectionDef[] = [
      { id: 'card-id',         labelKey: 'settings.section.card_id',   icon: 'tag',             render: this.renderCardIdSection.bind(this) },
      { id: 'review-behavior', labelKey: 'settings.section.review',    icon: 'book-open',       render: this.renderReviewBehaviorSection.bind(this) },
      { id: 'interface',       labelKey: 'settings.section.interface', icon: 'palette',         render: this.renderInterfaceSection.bind(this) },
      { id: 'license',         labelKey: 'settings.section.license',   icon: 'key-round',       render: this.renderLicenseSection.bind(this) },
      { id: 'danger-zone',     labelKey: 'settings.section.danger',    icon: 'alert-triangle',  render: this.renderDangerZoneSection.bind(this) },
    ];

    const iconEls = new Map<string, HTMLElement>();
    const sectionEls = new Map<string, HTMLElement>();

    // ── Sticky top nav strip ──
    const navStrip = containerEl.createDiv({ cls: 'gs-nav-strip' });

    for (const s of SECTIONS) {
      const icon = navStrip.createDiv({ cls: 'clickable-icon gs-nav-icon' });
      setIcon(icon, s.icon);
      setTooltip(icon, t(s.labelKey));
      icon.addEventListener('click', () => {
        const target = sectionEls.get(s.id);
        if (target) {
          const stripH = navStrip.getBoundingClientRect().height;
          const rect = target.getBoundingClientRect();
          const containerRect = containerEl.getBoundingClientRect();
          containerEl.scrollBy({ top: rect.top - containerRect.top - stripH - 8, behavior: 'smooth' });
        }
      });
      iconEls.set(s.id, icon);
    }

    // ── Content area: render each section ──
    for (const s of SECTIONS) {
      const sectionEl = containerEl.createDiv({ cls: 'gs-section-anchor' });
      sectionEls.set(s.id, sectionEl);
      s.render(sectionEl);
    }

    // ── Scroll-spy ──
    const updateActive = () => {
      const stripBottom = navStrip.getBoundingClientRect().bottom;
      let activeId = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = sectionEls.get(s.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - stripBottom < 24) activeId = s.id;
      }
      for (const [id, el] of iconEls) {
        el.toggleClass('is-active', id === activeId);
      }
    };

    containerEl.addEventListener('scroll', updateActive, { passive: true });
    setTimeout(updateActive, 0);
  }

  // ════════════════════════════════════════════════
  // Section 1: Card identification
  // ════════════════════════════════════════════════
  private renderCardIdSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'gs-set-section' });
    this.sectionHeader(section, t('settings.section.card_id'), t('settings.section.card_id_sub'));

    const settings = this.plugin.store.getSettings();

    new Setting(section)
      .setName(t('settings.trigger.name'))
      .setDesc(t('settings.trigger.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('#grind\n#flashcard')
          .setValue(settings.triggerTags.join('\n'))
          .onChange(async (value) => {
            const tags = value.split('\n').map((t) => t.trim()).filter((t) => t.length > 0);
            await this.plugin.store.updateSettings({ triggerTags: tags });
            this.scheduleRescan();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });

    new Setting(section)
      .setName(t('settings.exclude.name'))
      .setDesc(t('settings.exclude.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('#draft')
          .setValue(settings.excludeTags.join('\n'))
          .onChange(async (value) => {
            const tags = value.split('\n').map((t) => t.trim()).filter((t) => t.length > 0);
            await this.plugin.store.updateSettings({ excludeTags: tags });
            this.scheduleRescan();
          });
        text.inputEl.rows = 3;
        text.inputEl.cols = 30;
      });

    new Setting(section)
      .setName(t('settings.archive.name'))
      .setDesc(t('settings.archive.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('#archived')
          .setValue(settings.archiveTags.join('\n'))
          .onChange(async (value) => {
            const tags = value.split('\n').map((t) => t.trim()).filter((t) => t.length > 0);
            await this.plugin.store.updateSettings({ archiveTags: tags });
            this.scheduleRescan();
          });
        text.inputEl.rows = 3;
        text.inputEl.cols = 30;
      });

    new Setting(section)
      .setName(t('settings.prefix.name'))
      .setDesc(t('settings.prefix.desc'))
      .addToggle((toggle) => {
        toggle.setValue(settings.prefixMatch).onChange(async (value) => {
          await this.plugin.store.updateSettings({ prefixMatch: value });
          this.scheduleRescan();
        });
      });

    new Setting(section)
      .setName(t('settings.embed.name'))
      .setDesc(t('settings.embed.desc'))
      .addToggle((toggle) => {
        toggle.setValue(settings.embedCardIds ?? false).onChange(async (value) => {
          await this.plugin.store.updateSettings({ embedCardIds: value });
        });
      });
  }

  // ════════════════════════════════════════════════
  // Section 2: Review behavior
  // ════════════════════════════════════════════════
  private renderReviewBehaviorSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'gs-set-section' });
    this.sectionHeader(section, t('settings.section.review'), t('settings.section.review_sub'));

    const settings = this.plugin.store.getSettings();

    new Setting(section)
      .setName(t('settings.revieworder.name'))
      .setDesc(t('settings.revieworder.desc'))
      .addDropdown((dd) => {
        dd.addOption('random', t('settings.revieworder.random'));
        dd.addOption('due-date', t('settings.revieworder.duedate'));
        dd.addOption('as-added', t('settings.revieworder.asadded'));
        dd.setValue(settings.reviewOrder ?? 'random');
        dd.onChange(async (value) => {
          await this.plugin.store.updateSettings({ reviewOrder: value as ReviewOrder });
        });
      });

    new Setting(section)
      .setName(t('settings.autoshow.name'))
      .setDesc(t('settings.autoshow.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('#Grind')
          .setValue(settings.autoShowTags.join('\n'))
          .onChange(async (value) => {
            const tags = value.split('\n').map((t) => t.trim()).filter((t) => t.length > 0);
            await this.plugin.store.updateSettings({ autoShowTags: tags });
          });
        text.inputEl.rows = 3;
        text.inputEl.cols = 30;
      });

    new Setting(section)
      .setName(t('settings.stars.name'))
      .setDesc(t('settings.stars.desc'))
      .addToggle((toggle) => {
        toggle.setValue(settings.writeStarsBack).onChange(async (value) => {
          await this.plugin.store.updateSettings({ writeStarsBack: value });
        });
      });

    new Setting(section)
      .setName(t('settings.rename_tags.name'))
      .setDesc(t('settings.rename_tags.desc'))
      .addToggle((toggle) => {
        toggle.setValue(settings.renameTagsInVault ?? false).onChange(async (value) => {
          await this.plugin.store.updateSettings({ renameTagsInVault: value });
        });
      });

    new Setting(section)
      .setName(t('settings.streak.name'))
      .setDesc(t('settings.streak.desc'))
      .addToggle((toggle) => {
        toggle.setValue(settings.strictStreakMode === true).onChange(async (value) => {
          await this.plugin.store.updateSettings({ strictStreakMode: value });
          this.plugin.refreshAllWorkspaceViews();
        });
      });

    new Setting(section)
      .setName(t('settings.dayend.name'))
      .setDesc(t('settings.dayend.desc'))
      .addDropdown((dd) => {
        dd.addOption('0', '00:00');
        dd.addOption('1', '01:00');
        dd.addOption('2', '02:00');
        dd.setValue(String(settings.dayEndHour ?? 0));
        dd.onChange(async (value) => {
          const h: 0 | 1 | 2 = value === '1' ? 1 : value === '2' ? 2 : 0;
          await this.plugin.store.updateSettings({ dayEndHour: h });
          setDayEndHour(h);
          this.plugin.refreshAllWorkspaceViews();
        });
      });
  }

  // ════════════════════════════════════════════════
  // Section: Interface (with Language picker at top)
  // ════════════════════════════════════════════════
  private renderInterfaceSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'gs-set-section' });
    this.sectionHeader(section, t('settings.section.interface'), t('settings.section.interface_sub'));

    // ── Language picker (new) ──
    const langSetting = new Setting(section)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'));

    langSetting.addDropdown((dd) => {
      dd.addOption('zh', t('settings.language.zh'));
      dd.addOption('en', t('settings.language.en'));
      dd.setValue(getLang());
      dd.onChange(async (value) => {
        const newLang = value as Lang;
        if (getLang() === newLang) return;
        setLang(newLang);
        await this.plugin.store.updateSettings({ language: newLang });
        this.plugin.refreshAllWorkspaceViews();
        this.display();
      });
    });

    const settings = this.plugin.store.getSettings();

    new Setting(section)
      .setName(t('settings.slogans.name'))
      .setDesc(t('settings.slogans.desc', { defaults: DEFAULT_SLOGANS.join(' / ') }))
      .addTextArea((text) => {
        text
          .setPlaceholder(DEFAULT_SLOGANS.join('\n'))
          .setValue((settings.customSlogans ?? []).join('\n'))
          .onChange(async (value) => {
            const slogans = value.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
            await this.plugin.store.updateSettings({ customSlogans: slogans });
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 30;
      });
  }

  private sectionHeader(section: HTMLElement, zh: string, enSub: string): void {
    const hdr = section.createDiv({ cls: 'gs-set-header' });
    const titleWrap = hdr.createDiv({ cls: 'gs-set-title-md markdown-rendered' });
    MarkdownRenderer.render(this.app, `## ${zh}`, titleWrap, '', this.plugin);
    hdr.createDiv({ cls: 'gs-set-sub', text: enSub });
  }

  // ════════════════════════════════════════════════
  // Section: License (Pro)
  // ════════════════════════════════════════════════
  private renderLicenseSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'gs-set-section' });
    this.sectionHeader(section, t('settings.section.license'), t('settings.section.license_sub'));

    const lm = this.plugin.licenseManager;
    const ents = lm.entitlements();
    const infos = lm.keyInfos();
    const hasPro = ents.size > 0;

    // Status line + unlocked summary.
    const status = section.createDiv({
      cls: 'gs-license-status' + (hasPro ? ' gs-license-status--pro' : ''),
    });
    setIcon(status.createSpan(), hasPro ? 'badge-check' : 'circle');
    status.createSpan({
      text: hasPro ? t('license.settings.status_pro') : t('license.settings.status_free'),
    });
    if (hasPro) {
      const tabs = [...ents].map((e) => this.entLabel(e)).join(' · ');
      section.createDiv({ cls: 'gs-license-unlocked', text: t('license.settings.unlocked', { tabs }) });
    }

    // Activation input.
    let inputValue = '';
    const inputSetting = new Setting(section)
      .setName(t('license.settings.input_name'))
      .setDesc(t('license.settings.input_desc'));
    inputSetting.addText((txt) => {
      txt.setPlaceholder(t('license.settings.input_ph'));
      txt.onChange((v) => { inputValue = v; });
      txt.inputEl.style.width = '240px';
    });
    inputSetting.addButton((btn) => {
      btn.setButtonText(t('license.settings.activate')).setCta();
      btn.onClick(async () => {
        const token = inputValue.trim();
        if (!token) return;
        btn.setDisabled(true);
        btn.setButtonText(t('license.settings.activating'));
        const outcome = await lm.addKey(token);
        if (outcome.ok) {
          new Notice(t('license.notice.activated', {
            ent: outcome.entitlements.map((e) => this.entLabel(e)).join(' · '),
          }));
          this.plugin.refreshAllWorkspaceViews();
          this.display();
        } else {
          new Notice(this.addFailMessage(outcome.reason));
          btn.setDisabled(false);
          btn.setButtonText(t('license.settings.activate'));
        }
      });
    });

    // Buy CTA → afdian product page.
    new Setting(section).addButton((btn) => {
      btn.setButtonText(hasPro ? t('license.settings.add_another') : t('license.settings.buy'));
      btn.onClick(() => window.open(BUY_URL, '_blank'));
    });

    // Activated keys.
    if (infos.length) {
      new Setting(section).setName(t('license.settings.keys_header')).setHeading();
      const list = section.createDiv({ cls: 'gs-license-keys' });
      for (const info of infos) this.renderKeyRow(list, info);
      section.createDiv({
        cls: 'gs-license-vaultid-line',
        text: t('license.settings.vault_id', { id: lm.vaultId() }),
      });
    }

    // Support fallback.
    new Setting(section).addButton((btn) => {
      btn.setButtonText(t('license.settings.support'));
      btn.onClick(() => window.open('mailto:support@example.com?subject=Grindstone%20license', '_blank'));
    });
  }

  /** One key row + an on-demand "manage devices" expander (spec §4/§7). */
  private renderKeyRow(list: HTMLElement, info: KeyInfo): void {
    const lm = this.plugin.licenseManager;
    const row = list.createDiv({ cls: 'gs-license-key' });
    const main = row.createDiv({ cls: 'gs-license-key-main' });
    main.createDiv({
      cls: 'gs-license-key-ent',
      text: info.ent.map((e) => this.entLabel(e)).join(' · ') || '—',
    });
    main.createDiv({
      cls: 'gs-license-key-meta',
      text: `${info.oid} · ${info.activated_at ? info.activated_at.slice(0, 10) : ''}`,
    });

    row.createSpan({
      cls: `gs-license-key-status gs-license-key-status--${info.status}`,
      text: this.keyStatusLabel(info.status),
    });

    const manageBtn = row.createEl('button', { cls: 'gs-license-key-btn', text: t('license.settings.manage') });
    const removeBtn = row.createEl('button', { cls: 'gs-license-key-btn', text: t('license.settings.key_remove') });
    removeBtn.addEventListener('click', () => {
      lm.removeKey(info.token);
      new Notice(t('license.notice.removed'));
      this.plugin.refreshAllWorkspaceViews();
      this.display();
    });

    const vaultsEl = list.createDiv({ cls: 'gs-license-vaults' });
    vaultsEl.hide();
    let loaded = false;
    manageBtn.addEventListener('click', async () => {
      if (vaultsEl.isShown()) { vaultsEl.hide(); return; }
      vaultsEl.show();
      if (loaded) return;
      loaded = true;
      vaultsEl.empty();
      vaultsEl.createDiv({ cls: 'gs-license-vault', text: '…' });
      const acts = await lm.listActivations(info.token);
      vaultsEl.empty();
      if (acts.length === 0) {
        vaultsEl.createDiv({ cls: 'gs-license-vault', text: '—' });
        return;
      }
      const mine = lm.vaultId();
      for (const a of acts) {
        const v = vaultsEl.createDiv({ cls: 'gs-license-vault' });
        const isMine = a.vault_id === mine;
        v.createSpan({
          cls: 'gs-license-vault-id',
          text: a.vault_id.slice(0, 12) + (isMine ? ` ${t('license.settings.this_vault')}` : ''),
        });
        if (a.activated_at) v.createSpan({ text: a.activated_at.slice(0, 10) });
        const unbind = v.createEl('button', { cls: 'gs-license-key-btn', text: t('license.settings.unbind') });
        unbind.addEventListener('click', async () => {
          unbind.disabled = true;
          const ok = await lm.unbindVault(info.token, a.vault_id);
          if (ok) { new Notice(t('license.notice.unbound')); v.remove(); }
          else { unbind.disabled = false; new Notice(t('license.notice.network')); }
        });
      }
    });
  }

  private entLabel(e: Entitlement): string {
    if (e === 'all') return t('license.ent.all');
    const key = e.startsWith('tab:') ? e.slice(4) : e;
    if (key === 'cards') return t('license.ent.cards');
    if (key === 'strategy') return t('license.ent.strategy');
    if (key === 'radar') return t('license.ent.radar');
    return key;
  }

  private keyStatusLabel(s: KeyInfo['status']): string {
    return s === 'active'
      ? t('license.key.status_active')
      : s === 'revoked'
        ? t('license.key.status_revoked')
        : t('license.key.status_invalid');
  }

  private addFailMessage(reason: AddFailReason): string {
    switch (reason) {
      case 'bad_format':    return t('license.notice.bad_format');
      case 'bad_signature': return t('license.notice.bad_signature');
      case 'revoked':       return t('license.notice.revoked');
      case 'over_limit':    return t('license.notice.over_limit', { n: DEVICE_LIMIT });
      case 'duplicate':     return t('license.notice.duplicate');
      case 'network':
      default:              return t('license.notice.network');
    }
  }

  // ════════════════════════════════════════════════
  // Section: Danger zone
  // ════════════════════════════════════════════════
  private renderDangerZoneSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'gs-set-section gs-set-section-danger' });
    this.sectionHeader(section, t('settings.section.danger'), t('settings.section.danger_sub'));

    new Setting(section)
      .setName(t('settings.cleanup.name'))
      .setDesc(t('settings.cleanup.desc'))
      .addButton((btn) => {
        btn
          .setButtonText(t('settings.cleanup.button'))
          .onClick(async () => {
            new Notice(t('settings.cleanup.scanning'));
            await this.plugin.cardManager.fullScan();

            const orphanIds = new Set<string>();
            for (const [id, card] of Object.entries(this.plugin.store.getAllCards())) {
              if (card.disabled) orphanIds.add(id);
            }
            let logCount = 0;
            for (const log of this.plugin.store.getReviewLogs()) {
              if (orphanIds.has(log.cardId)) logCount++;
            }

            if (orphanIds.size === 0) {
              new Notice(t('settings.cleanup.notice_none'));
              return;
            }

            new CleanupOrphanCardsModal(
              this.app,
              orphanIds.size,
              logCount,
              async () => {
                this.plugin.store.removeOrphanCards();
                await this.plugin.store.flushSave();
                this.plugin.gsStore.invalidatePrimaryDeckCache();
                this.plugin.refreshAllWorkspaceViews();
              },
            ).open();
          });
      });

    new Setting(section)
      .setName(t('settings.reset.name'))
      .setDesc(t('settings.reset.desc'))
      .addButton((btn) => {
        btn
          .setButtonText(t('settings.reset.button'))
          .setWarning()
          .onClick(() => {
            const cardCount = Object.keys(this.plugin.store.getAllCards()).length;
            const logCount = this.plugin.store.getReviewLogs().length;
            new ResetLearningDataModal(this.app, cardCount, logCount, async () => {
              await this.plugin.resetLearningData();
              this.display();
            }).open();
          });
      });
  }

}

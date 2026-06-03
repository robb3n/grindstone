import { App } from 'obsidian';
import { GrindstoneStore } from '../../store/GrindstoneStore';
import { CardManager } from '../../card/card-manager';
import { ReviewEngine } from '../../review/review-engine';
import { CramItem } from '../../review/cram-engine';
import { DeckFilter } from '../../card/types';
import { TabId } from '../WorkspaceView';

export interface TabContext {
  store: GrindstoneStore;
  cardManager: CardManager;
  app: App;
  onNavigate: (tab: TabId, opts?: { tag?: string }) => void;
  startReviewModal: (tag?: string) => void;
  /** Start inline review in the workspace Review tab. */
  startInlineReview: (tag?: string) => void;
  /** Get the active inline review engine (null if not reviewing). */
  getReviewEngine: () => ReviewEngine | null;
  /** End the inline review session and return to pre-flight. */
  endInlineReview: () => void;
  /** Re-render the current tab. */
  refreshTab: () => void;
  /** Open the active-review (cram) modal with a given filtered queue. */
  startCram: (queue: CramItem[], filter: DeckFilter, deckId?: string) => void;
  /**
   * THE Pro-gate router (spec §5). Each Pro entry point calls this in its own
   * mount point; locked → render a Teaser. Re-verifies the license every call,
   * no cached `isPro`.
   */
  canUseTab: (id: string) => boolean;
  /** Open Obsidian settings on the Grindstone License section (Teaser CTA). */
  openLicenseSettings: () => void;
}

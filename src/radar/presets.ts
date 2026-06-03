import { RadarMetricKey } from './types';

export interface RadarPreset {
  id: string;
  name: string;
  nameEn: string;
  ico: string;
  dimensions: RadarMetricKey[];
}

export const RADAR_PRESETS: RadarPreset[] = [
  {
    id: 'classic6',
    name: '经典 6 轴',
    nameEn: 'Classic 6',
    ico: '📐',
    dimensions: [
      'retentionLong',
      'quickAnswerRate',
      'firstTryAccuracy',
      'currentStreak',
      'masteredCount',
      'advancedRatio',
    ],
  },
  {
    id: 'feasible5',
    name: '稳健 5 轴',
    nameEn: 'Steady 5',
    ico: '✅',
    dimensions: [
      'retentionLong',
      'firstTryAccuracy',
      'monthlyCompletion',
      'masteredCount',
      'newToMatureSpeed',
    ],
  },
  {
    id: 'ambitious7',
    name: '进阶 7 轴',
    nameEn: 'Ambitious 7',
    ico: '🚀',
    dimensions: [
      'recallOld',
      'responseTimeAvg',
      'firstTryAccuracy',
      'maxStreak',
      'tagCount',
      'advancedRatio',
      'selfCalibration',
    ],
  },
];

export const DEFAULT_RADAR_DIMENSIONS: RadarMetricKey[] = RADAR_PRESETS[0].dimensions;

import { Rating } from '../card/types';

export interface RatingLabel {
  rating: Rating;
  key: string;
}

export const RATING_LABELS: RatingLabel[] = [
  { rating: 'again', key: '1' },
  { rating: 'hard',  key: '2' },
  { rating: 'good',  key: '3' },
  { rating: 'easy',  key: '4' },
];

export const RATING_KEY_MAP: Record<string, Rating> = {
  '1': 'again',
  '2': 'hard',
  '3': 'good',
  '4': 'easy',
};

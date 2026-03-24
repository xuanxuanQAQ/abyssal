/**
 * useVersionRetention — Version retention policy calculation (S8.3)
 *
 * Determines which section versions should be kept vs. pruned based on
 * time-window-based retention rules:
 *
 *   0-1 hour:   keep all versions
 *   1-24 hours: keep one per 10-minute bucket
 *   1-7 days:   keep one per hour bucket
 *   7+ days:    keep one per day bucket
 *
 * AI-generated versions (source = 'ai-generate' | 'ai-rewrite') are
 * ALWAYS retained regardless of age.
 */

import type { SectionVersion } from '../../../../shared-types/models';

export interface RetentionResult {
  keep: SectionVersion[];
  prune: SectionVersion[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function isAIVersion(version: SectionVersion): boolean {
  return version.source === 'ai-generate' || version.source === 'ai-rewrite';
}

/**
 * Assign a version to a time bucket key based on its age.
 * Returns null if the version falls in the "keep all" window (< 1 hour).
 */
function getBucketKey(createdAt: Date, now: Date): string | null {
  const ageMs = now.getTime() - createdAt.getTime();

  if (ageMs < HOUR) {
    // Within 1 hour: keep all — no bucketing needed
    return null;
  }

  if (ageMs < DAY) {
    // 1-24 hours: bucket by 10-minute intervals
    const tenMinBucket = Math.floor(createdAt.getTime() / (10 * MINUTE));
    return `10min-${tenMinBucket}`;
  }

  if (ageMs < 7 * DAY) {
    // 1-7 days: bucket by hour
    const hourBucket = Math.floor(createdAt.getTime() / HOUR);
    return `hour-${hourBucket}`;
  }

  // 7+ days: bucket by day
  const dayBucket = Math.floor(createdAt.getTime() / DAY);
  return `day-${dayBucket}`;
}

/**
 * Compute which versions to keep and which to prune based on the
 * retention policy.
 *
 * @param versions - All section versions (any order)
 * @param now      - Reference time (defaults to current time)
 */
export function computeRetention(
  versions: SectionVersion[],
  now?: Date,
): RetentionResult {
  const referenceTime = now ?? new Date();
  const keep: SectionVersion[] = [];
  const prune: SectionVersion[] = [];

  // Sort by createdAt descending (newest first) so that within each bucket
  // we keep the most recent version.
  const sorted = [...versions].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Track which buckets have already been claimed
  const seenBuckets = new Set<string>();

  for (const version of sorted) {
    // AI versions are always kept
    if (isAIVersion(version)) {
      keep.push(version);
      continue;
    }

    const createdAt = new Date(version.createdAt);
    const bucketKey = getBucketKey(createdAt, referenceTime);

    if (bucketKey === null) {
      // Within the 1-hour "keep all" window
      keep.push(version);
    } else if (!seenBuckets.has(bucketKey)) {
      // First (newest) version in this bucket — keep it
      seenBuckets.add(bucketKey);
      keep.push(version);
    } else {
      // Duplicate in an already-claimed bucket — prune it
      prune.push(version);
    }
  }

  return { keep, prune };
}

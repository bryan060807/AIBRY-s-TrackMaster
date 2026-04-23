function mapTimestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function mapNullableNumber(value) {
  if (value === null || value === undefined) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

export function mapUserRow(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    email: row.email,
    createdAt: mapTimestamp(row.created_at),
  };
}

export function mapUserWithPasswordRow(row) {
  const user = mapUserRow(row);
  if (!user) return undefined;
  return {
    ...user,
    passwordHash: row.password_hash,
  };
}

export function mapSessionUserRow(row) {
  const user = mapUserRow(row);
  if (!user) return undefined;
  return {
    ...user,
    sessionId: row.session_id,
  };
}

export function mapPresetRow(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    createdAt: mapTimestamp(row.created_at),
    updatedAt: mapTimestamp(row.updated_at),
    params: {
      eqLow: row.eq_low,
      eqMid: row.eq_mid,
      eqHigh: row.eq_high,
      compThreshold: row.comp_threshold,
      compRatio: row.comp_ratio,
      makeupGain: row.makeup_gain,
      delayTime: row.delay_time,
      delayFeedback: row.delay_feedback,
      delayMix: row.delay_mix,
      reverbDecay: row.reverb_decay,
      reverbMix: row.reverb_mix,
      saturationDrive: row.saturation_drive,
      saturationMix: row.saturation_mix,
    },
  };
}

export function mapTrackRow(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    status: row.status,
    durationSeconds: row.duration_seconds,
    sizeBytes: mapNullableNumber(row.size_bytes),
    format: row.format,
    createdAt: mapTimestamp(row.created_at),
  };
}

function changeCount(result) {
  if (Number.isFinite(result?.changes)) return result.changes;
  if (Number.isFinite(result?.rowCount)) return result.rowCount;
  return 0;
}

export function mapCreatedMutationResult() {
  return { created: true };
}

export function mapChangedMutationResult(result) {
  return { changed: changeCount(result) > 0 };
}

export function mapDeletedMutationResult(result) {
  return { deleted: changeCount(result) > 0 };
}

export function mapCountedDeleteMutationResult(result) {
  const deletedCount = changeCount(result);
  return {
    deleted: deletedCount > 0,
    deletedCount,
  };
}

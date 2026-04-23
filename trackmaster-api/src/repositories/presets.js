import { mapDeletedMutationResult, mapPresetRow } from './mappers.js';

export function createPresetsRepository(db) {
  const repository = {
    listForUser(userId) {
      return db.prepare(`
        SELECT *
        FROM presets
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId).map(mapPresetRow);
    },

    findForUser(id, userId) {
      const row = db.prepare(`
        SELECT *
        FROM presets
        WHERE id = ?
          AND user_id = ?
      `).get(id, userId);
      return mapPresetRow(row);
    },

    create(values) {
      db.prepare(`
        INSERT INTO presets (
          id, user_id, name, eq_low, eq_mid, eq_high, comp_threshold, comp_ratio, makeup_gain,
          delay_time, delay_feedback, delay_mix, reverb_decay, reverb_mix, saturation_drive, saturation_mix
        )
        VALUES (
          @id, @userId, @name, @eqLow, @eqMid, @eqHigh, @compThreshold, @compRatio, @makeupGain,
          @delayTime, @delayFeedback, @delayMix, @reverbDecay, @reverbMix, @saturationDrive, @saturationMix
        )
      `).run(values);
      return repository.findForUser(values.id, values.userId);
    },

    updateForUser(id, userId, values) {
      db.prepare(`
        UPDATE presets
        SET name = @name,
            eq_low = @eqLow,
            eq_mid = @eqMid,
            eq_high = @eqHigh,
            comp_threshold = @compThreshold,
            comp_ratio = @compRatio,
            makeup_gain = @makeupGain,
            delay_time = @delayTime,
            delay_feedback = @delayFeedback,
            delay_mix = @delayMix,
            reverb_decay = @reverbDecay,
            reverb_mix = @reverbMix,
            saturation_drive = @saturationDrive,
            saturation_mix = @saturationMix,
            updated_at = datetime('now')
        WHERE id = @id
          AND user_id = @userId
      `).run({ id, userId, ...values });
      const preset = repository.findForUser(id, userId);
      return { changed: Boolean(preset), preset };
    },

    deleteForUser(id, userId) {
      const result = db.prepare(`
        DELETE FROM presets
        WHERE id = ?
          AND user_id = ?
      `).run(id, userId);
      return mapDeletedMutationResult(result);
    },
  };
  return repository;
}

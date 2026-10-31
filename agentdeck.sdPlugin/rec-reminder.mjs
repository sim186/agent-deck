// State rules for the optional whole-deck recording reminder.
export const reminderId = (meeting, isTest = false) => isTest ? 'test-meeting' : meeting ? `meeting:${meeting.start}` : null;

// Returns an active meeting's stable identity even while recording, so stopping Rec can
// suppress the reminder that would otherwise reappear after transcription finishes.
export function activeReminderId({ meeting, now = Date.now(), isTest = false }) {
  const id = reminderId(meeting, isTest);
  return id && meeting.start <= now ? id : null;
}

export function shouldShowReminder({ meeting, now = Date.now(), recorderIdle, dismissedId, isTest = false }) {
  const id = activeReminderId({ meeting, now, isTest });
  return Boolean(id && recorderIdle && dismissedId !== id);
}

// OpenDeck lets only its bundled Starter Pack switch profiles. Agent Deck therefore
// draws the reminder over the current profile; Rec starts the recorder, any other key
// acknowledges the reminder without invoking its normal action.
export function reminderPress({ visible, action, mode, recorderIdle }) {
  if (!visible) return 'pass';
  return action === 'meeting' && (mode ?? 'toggle') === 'toggle' && recorderIdle ? 'record' : 'dismiss';
}

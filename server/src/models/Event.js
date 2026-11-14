const mongoose = require('mongoose');

// Calendar events & meetings (module 31). Times are stored as UTC instants
// (startAt/endAt) plus the event's own IANA `timezone`, so every viewer can
// render the event in their local zone while the original zone stays
// visible when it differs.
const attendeeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['invited', 'accepted', 'declined'],
      default: 'invited',
    },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 2000 },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    timezone: { type: String, default: 'UTC', maxlength: 64 },
    location: { type: String, default: '', maxlength: 300 },
    meetingLink: { type: String, default: '', maxlength: 500 },
    // Minutes before startAt at which each participant gets one in-app
    // reminder notification (fired by the reminder checker service).
    reminderMinutes: { type: [Number], default: [15] },
    attendees: { type: [attendeeSchema], default: [] },
    // Reminder bookkeeping: "<userId>:<minutesBefore>" keys already fired,
    // so the interval checker never notifies twice for the same reminder.
    remindersSent: { type: [String], default: [], select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Event', eventSchema);

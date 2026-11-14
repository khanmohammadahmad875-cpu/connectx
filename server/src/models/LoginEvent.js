const mongoose = require('mongoose');

// Login history (module 22): one record per login attempt against a known
// account (successful or not). Powers the Security view's history list and
// the "new sign-in" detection (a successful login from an IP + user-agent
// combination the account has never used before raises a notification).
const loginEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ip: { type: String, default: '', maxlength: 64 },
    userAgent: { type: String, default: '', maxlength: 400 },
    success: { type: Boolean, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LoginEvent', loginEventSchema);

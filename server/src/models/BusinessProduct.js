const mongoose = require('mongoose');

// A product/service in a business catalogue (v3.0 module 30). Owned by one
// user (the business); only the owner may create/edit/delete — the routes
// enforce that, the public business page only reads.
const businessProductSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: '', maxlength: 8 },
    image: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BusinessProduct', businessProductSchema);
